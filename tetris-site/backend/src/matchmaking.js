// ─── MatchmakingQueue Durable Object ─────────────────────────────
// Manages ELO-based queue for ranked and casual multiplayer.
//
// Two singleton instances - one per mode:
//   MatchmakingQueue.idFromName('ranked-versus')
//   MatchmakingQueue.idFromName('casual-versus')
//
// WebSocket protocol (client → server):
//   { type:'enqueue', sessionId, userId, username, displayName, elo, mode }
//   { type:'leave' }
//   { type:'ping' }
//
// WebSocket protocol (server → client):
//   { type:'queued',      queueSize }
//   { type:'queueUpdate', position, queueSize, eloDelta, waitSecs }
//   { type:'matchFound',  roomCode, gameMode:'versus', isRanked:bool,
//                         opponent:{ username, displayName, elo } }
//   { type:'left' }
//   { type:'pong' }
//   { type:'error', reason }

const ROOM_EXPIRY_SEC   = 7200;   // 2 hours KV TTL for game room
const ELO_RANGE_START   = 100;    // initial ±ELO range
const ELO_RANGE_STEP    = 50;     // expand ±N every interval
const ELO_RANGE_INTERVAL= 15_000; // expand every 15 s
const ELO_RANGE_MAX     = 600;    // hard cap

// How often (ms) to re-examine the queue for expanded ranges / status updates
const ALARM_INTERVAL_MS = 3_000;

export class MatchmakingQueue {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    // sessionId → { ws, sessionId, userId, username, displayName, elo, mode, joinedAt }
    this.queue = new Map();
  }

  // ── WebSocket ─────────────────────────────────────────────────

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMsg) {
    let data;
    try { data = JSON.parse(rawMsg); } catch { return; }

    switch (data.type) {

      case 'enqueue': {
        // Validate required fields
        if (!data.userId || !data.username) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Must be signed in to queue.' }));
          ws.close(4001, 'Unauthenticated');
          return;
        }

        // Prevent double-queueing same user (rare race - just remove old entry)
        for (const [sid, p] of this.queue.entries()) {
          if (p.userId === data.userId) {
            this.queue.delete(sid);
            try { p.ws.send(JSON.stringify({ type: 'left' })); p.ws.close(); } catch {}
          }
        }

        const sessionId = data.sessionId || crypto.randomUUID();
        // Prefer the mode the client explicitly sent; fall back to the DO name.
        // this.state.id.name can be unreliable in local wrangler dev.
        const queueMode = (['ranked-versus','casual-versus','sprint','coop'].includes(data.mode))
          ? data.mode
          : (this.state.id.name || 'casual-versus');
        const entry = {
          ws, sessionId,
          userId:      data.userId,
          username:    (data.username    || '').slice(0, 30),
          displayName: (data.displayName || '').slice(0, 30),
          elo:         typeof data.elo === 'number' ? Math.round(data.elo) : 1000,
          xp:          typeof data.xp  === 'number' ? data.xp : null,
          mode:        queueMode,
          joinedAt:    Date.now(),
        };
        this.queue.set(sessionId, entry);

        ws.send(JSON.stringify({ type: 'queued', queueSize: this.queue.size }));

        // Try to find a match right away
        await this.tryMatchFor(entry);

        // Schedule periodic re-check (in case no match yet)
        try {
          const alarmTime = await this.state.storage.getAlarm();
          if (!alarmTime) {
            await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
          }
        } catch { /* alarm API may be unavailable locally */ }
        break;
      }

      case 'leave': {
        this.removeByWs(ws);
        ws.send(JSON.stringify({ type: 'left' }));
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  }

  async webSocketClose(ws) {
    this.removeByWs(ws);
  }

  // ── Alarm (periodic re-scan) ──────────────────────────────────

  async alarm() {
    if (this.queue.size >= 2) {
      await this.scanQueue();
    }

    if (this.queue.size > 0) {
      // Send status updates + re-schedule
      this.sendStatusUpdates();
      try {
        await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      } catch {}
    }
  }

  // ── Matching logic ────────────────────────────────────────────

  /**
   * Try to immediately match a newly joined player against the existing queue.
   */
  async tryMatchFor(newEntry) {
    const now = Date.now();
    for (const [sid, candidate] of this.queue.entries()) {
      if (candidate.sessionId === newEntry.sessionId) continue;
      if (this.isCompatible(newEntry, candidate, now)) {
        await this.createMatch(newEntry, candidate);
        return true;
      }
    }
    return false;
  }

  /**
   * Scan the full queue for any two compatible players.
   * Called by the alarm on a schedule.
   */
  async scanQueue() {
    const now     = Date.now();
    const players = [...this.queue.values()];
    // Oldest waiters first so they get priority
    players.sort((a, b) => a.joinedAt - b.joinedAt);

    const matched = new Set();
    for (let i = 0; i < players.length; i++) {
      if (matched.has(players[i].sessionId)) continue;
      for (let j = i + 1; j < players.length; j++) {
        if (matched.has(players[j].sessionId)) continue;
        if (this.isCompatible(players[i], players[j], now)) {
          matched.add(players[i].sessionId);
          matched.add(players[j].sessionId);
          await this.createMatch(players[i], players[j]);
          break;
        }
      }
    }
  }

  /**
   * Check if two queue entries are compatible (ELO range + not same user).
   */
  isCompatible(a, b, now = Date.now()) {
    if (a.userId === b.userId) return false;
    // Use the mode stored on the entry (set from the client's enqueue message)
    if (a.mode !== b.mode) return false; // never cross-match different modes
    // Instant-match modes: no ELO requirement
    if (a.mode === 'casual-versus' || a.mode === 'coop') return true;
    // Ranked / ELO modes (ranked-versus, sprint): expand range over time
    const rangeA = this.computeRange(a, now);
    const rangeB = this.computeRange(b, now);
    const effectiveRange = Math.max(rangeA, rangeB);
    return Math.abs(a.elo - b.elo) <= effectiveRange;
  }

  computeRange(entry, now = Date.now()) {
    const waitSecs  = (now - entry.joinedAt) / 1000;
    const steps     = Math.floor(waitSecs * 1000 / ELO_RANGE_INTERVAL);
    return Math.min(ELO_RANGE_MAX, ELO_RANGE_START + steps * ELO_RANGE_STEP);
  }

  /**
   * Pair two players: remove from queue, create room, notify both.
   */
  async createMatch(p1, p2) {
    // Remove from queue immediately to prevent double-matching
    this.queue.delete(p1.sessionId);
    this.queue.delete(p2.sessionId);

    // Allocate game room code
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    try {
      if (this.env.RATE_KV) {
        await this.env.RATE_KV.put(`room:${roomCode}`, '1', { expirationTtl: ROOM_EXPIRY_SEC });
      }
    } catch (e) {
      console.error('KV room creation failed:', e);
    }

    // Use the mode stored on the queue entry — reliable even in local wrangler dev
    // where this.state.id.name may not reflect the idFromName() string.
    const mode = p1.mode; // both entries have the same mode (enforced by isCompatible)
    const isRanked = mode === 'ranked-versus';
    const gameMode = (mode === 'ranked-versus' || mode === 'casual-versus') ? 'versus' : mode;
    const base = { type: 'matchFound', roomCode, gameMode, isRanked };

    try {
      p1.ws.send(JSON.stringify({
        ...base,
        opponent: { username: p2.username, displayName: p2.displayName, elo: p2.elo, xp: p2.xp },
      }));
    } catch {}

    try {
      p2.ws.send(JSON.stringify({
        ...base,
        opponent: { username: p1.username, displayName: p1.displayName, elo: p1.elo, xp: p1.xp },
      }));
    } catch {}
  }

  // ── Helpers ───────────────────────────────────────────────────

  removeByWs(ws) {
    for (const [sid, p] of this.queue.entries()) {
      if (p.ws === ws) {
        this.queue.delete(sid);
        return;
      }
    }
  }

  sendStatusUpdates() {
    const now  = Date.now();
    let pos = 1;
    const sorted = [...this.queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    for (const p of sorted) {
      const waitSecs  = Math.round((now - p.joinedAt) / 1000);
      const eloDelta  = this.computeRange(p, now);
      try {
        p.ws.send(JSON.stringify({
          type: 'queueUpdate',
          position:  pos++,
          queueSize: this.queue.size,
          eloDelta,
          waitSecs,
        }));
      } catch {}
    }
  }
}
