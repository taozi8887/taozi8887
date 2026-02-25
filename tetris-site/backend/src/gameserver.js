// ─── GameRoom Durable Object ──────────────────────────────────────
// Handles live multiplayer room lifecycle.
// Virtually identical to the existing server/src/index.js Durable Object
// but with two additions:
//  1. Tracks authenticated player IDs when provided in the join message.
//  2. POSTs match result to /api/stats/record after the game ends.

const ROOM_TIMEOUT_MS      = 5 * 60 * 1000;  // 5 min idle → close
const START_COUNTDOWN_MS   = 1000;            // 1 s delay after both ready
const COOP_TARGET_DEFAULT  = 150;
const SPRINT_TARGET_DEFAULT = 40;
const GARBAGE_CANCEL       = true;           // lines cancel pending garbage
const MAX_PENDING_GARBAGE  = 20;

// Attack table: lines cleared → garbage sent (Tetris Guideline)
const VERSUS_ATK  = [0, 0, 1, 2, 4];
const TSPIN_ATK   = [0, 2, 4, 6];
const B2B_BONUS   = 1;
const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

export class GameRoom {
  constructor(state, env) {
    this.state  = state;
    this.env    = env;
    this.players  = new Map();   // id → { ws, name, ready, over, score, lines, seed, userId }
    this.nextId   = 0;
    this.started  = false;
    this.finished = false;
    this.mode     = 'versus';
    this.isRanked = true;   // false for casual/unranked matches
    this.roomCode = '';
    this.seed     = 0;
    this.sharedLevel = 1;  // shared gravity level for versus mode
    this.sprintTarget  = SPRINT_TARGET_DEFAULT;
    this.coopTarget    = COOP_TARGET_DEFAULT;
    this.coopLines     = 0;
    this.startTime     = 0;
    this.idleTimer     = null;
    this.resetIdleTimer();
  }

  // ── WebSocket ───────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    this.roomCode = url.pathname.split('/').pop();

    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected WebSocket', { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    this.resetIdleTimer();
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    const player = [...this.players.values()].find(p => p.ws === ws);

    switch (data.type) {

      case 'join': {
        if (this.players.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Room is full.' }));
          ws.close(); return;
        }
        if (this.finished) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Match already finished.' }));
          ws.close(); return;
        }
        const id = this.nextId++;
        const p  = {
          ws, id,
          name:        (data.name        || 'Player ' + (id + 1)).slice(0, 30),
          username:    (data.username    || '').slice(0, 30),
          displayName: (data.displayName || '').slice(0, 30),
          elo:         typeof data.elo === 'number' ? Math.round(data.elo) : null,
          xp:          typeof data.xp  === 'number' ? data.xp : null,
          userId: data.userId || null,
          ready:  false, over: false,
          score: 0, lines: 0,
          b2bActive: false, combo: -1,
          pendingGarbage: 0,
          stats: { tetrises: 0, tSpins: 0, b2bMax: 0, maxCombo: 0, maxLevel: 0, pieces: 0 },
          garbageSent: 0,
          board: null,
        };
        this.players.set(id, p);

        // Set mode and ranked flag from first player's join
        if (id === 0) {
          if (data.mode) this.mode = data.mode;
          if (typeof data.isRanked === 'boolean') this.isRanked = data.isRanked;
        }

        ws.send(JSON.stringify({ type: 'joined', playerId: id, mode: this.mode, players: this.mapPlayers() }));
        this.broadcast({ type: 'playerJoined', players: this.mapPlayers() });
        break;
      }

      case 'ready': {
        if (!player) return;
        player.ready = true;
        this.broadcast({ type: 'playerReady', players: this.mapPlayers() });

        if (this.players.size === 2 && [...this.players.values()].every(p => p.ready) && !this.started) {
          setTimeout(() => this.startGame(), START_COUNTDOWN_MS);
        }
        break;
      }

      case 'event': {
        if (!player || !this.started || player.over) return;
        const kind = data.kind;

        if (kind === 'piecePlaced') {
          player.score  = data.score  || player.score;
          player.lines  += (data.lines || 0);           // accumulate, not assign
          player.board  = data.boardSnapshot || player.board;
          player.stats.pieces++;
          if (data.maxLevel) player.stats.maxLevel = Math.max(player.stats.maxLevel, data.maxLevel);

          // Calculate lines cleared + attack from T-spin / lines
          const linesCleared = data.lines || 0;
          const tSpin = data.tSpin || 'none';
          const prevB2b = player.b2bActive;

          let atk = 0;
          let isDiff = false;
          if (tSpin === 'tspin') {
            isDiff = true; player.stats.tSpins++;
            atk = TSPIN_ATK[Math.min(linesCleared, 3)] || 0;
          } else if (linesCleared === 4) {
            isDiff = true; player.stats.tetrises++;
            atk = VERSUS_ATK[4];
          } else {
            atk = VERSUS_ATK[Math.min(linesCleared, 4)] || 0;
          }

          // Perfect clear: overrides attack to 10 lines and counts as difficult (B2B)
          if (data.perfectClear && linesCleared > 0) {
            atk = 10;
            isDiff = true;
          }

          if (isDiff && prevB2b) atk += B2B_BONUS;
          player.b2bActive = isDiff;

          if (linesCleared > 0) {
            player.combo++;
            const comboAtk = COMBO_TABLE[Math.min(player.combo, COMBO_TABLE.length - 1)] || 0;
            atk += comboAtk;
            player.stats.maxCombo = Math.max(player.stats.maxCombo, player.combo);
            if (isDiff) {
              player.stats.b2bCurrent = (player.stats.b2bCurrent || 0) + 1;
              player.stats.b2bMax = Math.max(player.stats.b2bMax || 0, player.stats.b2bCurrent);
            } else {
              player.stats.b2bCurrent = 0;
            }
          } else {
            player.combo = -1;
            if (!isDiff) player.stats.b2bCurrent = 0;
          }

          const opp = this.opponent(player.id);
          if (opp && !opp.over && this.mode === 'versus' && atk > 0) {
            // Garbage cancellation
            const cancel = Math.min(atk, opp.pendingGarbage);
            opp.pendingGarbage -= cancel;
            const netAtk = atk - cancel;
            if (netAtk > 0) {
              player.garbageSent += netAtk;
              opp.pendingGarbage = Math.min(MAX_PENDING_GARBAGE, opp.pendingGarbage + netAtk);
              // Generate random hole positions server-side
              const lines = [];
              const holeCol = Math.floor(Math.random() * 10);
              for (let i = 0; i < netAtk; i++) lines.push({ holeCol });
              opp.ws.send(JSON.stringify({
                type: 'incomingGarbage',
                pending: opp.pendingGarbage,
                amount:  netAtk,
                fromName: player.name,
                garbageLines: lines,
              }));
            }
          }

          // Sprint coop line count
          if (this.mode === 'sprint' || this.mode === 'coop') {
            this.coopLines += linesCleared;
            if (this.mode === 'coop') {
              this.broadcast({ type: 'coopProgress', total: this.coopLines, target: this.coopTarget });
              if (this.coopLines >= this.coopTarget) {
                this.endGame({ type: 'coopWin', lines: this.coopLines });
              }
            } else if (this.mode === 'sprint') {
              // player.lines is already accumulated above; just check it
              if (player.lines >= this.sprintTarget) {
                const elapsed = Math.round((Date.now() - this.startTime) / 1000);
                this.endGame({ type: 'sprintWin', winner: player.id, elapsed, winnerName: player.name });
              }
            }
          }

          // Shared gravity: broadcast to both players when level advances in versus
          if (this.mode === 'versus' && linesCleared > 0) {
            const oppLines = this.opponent(player.id)?.lines || 0;
            const newSharedLevel = Math.floor(Math.max(player.lines, oppLines) / 10) + 1;
            if (newSharedLevel > this.sharedLevel) {
              this.sharedLevel = newSharedLevel;
              this.broadcast({ type: 'gravitySync', level: this.sharedLevel });
            }
          }

          // Relay board update to opponent
          if (opp) {
            opp.ws.send(JSON.stringify({
              type: 'opponentUpdate',
              score:    player.score,
              lines:    player.lines,
              snapshot: player.board,
            }));
          }

          // Confirm to placer
          player.ws.send(JSON.stringify({
            type: 'pieceConfirmed',
            lines: linesCleared, tSpin, atk,
            b2b: isDiff && prevB2b,
            score: player.score,
          }));
        }

        if (kind === 'gameOver') {
          player.score = data.score ?? player.score;
          player.over = true;
          this.broadcast({ type: 'playerOver', playerId: player.id, name: player.name });
          const opp = this.opponent(player.id);
          if (opp && !opp.over && this.mode === 'versus') {
            // Opponent wins
            this.endGame({ type: 'versusEnd', winner: opp.id });
          } else if (this.mode === 'sprint' && !this.finished) {
            const elapsed = Math.round((Date.now() - this.startTime) / 1000);
            const opp2 = opp;
            const winnerId = opp2 && !opp2.over ? opp2.id : null;
            this.endGame({ type: 'sprintWin', winner: winnerId, elapsed, winnerName: opp2?.name || '' });
          } else if (this.mode === 'coop' && !this.finished) {
            // Both players topped out — co-op loss
            const allOver = [...this.players.values()].every(p => p.over);
            if (allOver) this.endGame({ type: 'coopLoss' });
          }
        }

        if (kind === 'scoreSync') {
          player.score = data.score ?? player.score;
        }

        if (kind === 'garbageApplied') {
          player.pendingGarbage = Math.max(0, player.pendingGarbage - (data.count || 0));
        }

        // Periodic board + active-piece snapshot sent every ~150ms from client.
        // Relay to opponent so the board updates even when no piece is being placed.
        if (kind === 'boardHeartbeat') {
          if (data.snapshot) player.board = data.snapshot;
          if (typeof data.score === 'number') player.score = data.score;
          const oppHB = this.opponent(player.id);
          if (oppHB && !oppHB.over) {
            oppHB.ws.send(JSON.stringify({
              type: 'opponentUpdate',
              score:    player.score,
              lines:    player.lines,
              snapshot: player.board,
            }));
          }
        }
        break;
      }

      case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;

      case 'chat': {
        if (!player) return;
        const text = (data.text || '').slice(0, 80).replace(/</g, '&lt;');
        this.broadcast({ type: 'chat', name: player.name, text });
        break;
      }

      case 'closeLobby': {
        if (!player || player.id !== 0) return; // only host
        this.broadcast({ type: 'lobbyClosed' });
        // Expire any pending challenge for this room so it disappears from the recipient's inbox
        if (this.env?.DB && this.roomCode) {
          this.env.DB.prepare("UPDATE challenges SET status='expired' WHERE room_code=?1 AND status='pending'")
            .bind(this.roomCode).run().catch(() => {});
        }
        this.cleanup();
        break;
      }
    }
  }

  async webSocketClose(ws) {
    const player = [...this.players.values()].find(p => p.ws === ws);
    if (!player) return;
    if (this.started && !this.finished) {
      const opp = this.opponent(player.id);
      if (opp) {
        // Keep disconnected player in the map so recordMatchResult can see both participants
        player.over = true;
        if (this.mode === 'coop') {
          await this.endGame({ type: 'coopLoss', reason: 'disconnect' });
        } else {
          await this.endGame({ type: 'versusEnd', winner: opp.id, reason: 'disconnect' });
        }
      }
      this.players.delete(player.id);
    } else if (!this.started) {
      this.players.delete(player.id);
      this.broadcast({ type: 'playerLeft', name: player.name, players: this.mapPlayers() });
    } else {
      this.players.delete(player.id);
    }
  }

  // ── Game lifecycle ───────────────────────────────────────────────

  startGame() {
    if (this.started || this.players.size < 2) return;
    this.started     = true;
    this.startTime   = Date.now();
    this.coopLines   = 0;
    this.sharedLevel = 1;
    this.seed        = Math.floor(Math.random() * 2 ** 31);
    for (const p of this.players.values()) {
      p.over = false; p.score = 0; p.lines = 0;
      p.b2bActive = false; p.combo = -1; p.pendingGarbage = 0;
    }
    this.broadcast({
      type: 'start', seed: this.seed, mode: this.mode, isRanked: this.isRanked,
      sprintTarget: this.sprintTarget, coopTarget: this.coopTarget,
      players: this.mapPlayers(),
    });
  }

  async endGame(payload) {
    if (this.finished) return;
    this.finished = true;

    const scores = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, lines: p.lines, garbageSent: p.garbageSent || 0,
    }));

    // Try to record match first so ELO deltas can be included in the broadcast
    let eloDeltas = {};
    let xpData = {};
    try {
      const result = await this.recordMatchResult(payload);
      if (result) { eloDeltas = result.eloDeltas || {}; xpData = result.xpData || {}; }
    } catch (e) { console.error('recordMatch error:', e); }

    const msg = { ...payload, type: 'gameEnd', gameType: payload.type, scores, eloDeltas, xpData, isRanked: this.isRanked };
    this.broadcast(msg);

    // Reset for rematch
    setTimeout(() => {
      this.started = false; this.finished = false;
      this.isRanked = true; // reset to default for next use of this room
      for (const p of this.players.values()) { p.ready = false; p.over = false; }
      this.broadcast({ type: 'reset', players: this.mapPlayers() });
    }, 5000);
  }

  async recordMatchResult(payload) {
    if (!this.env?.DB) return;
    const ps     = [...this.players.values()];
    if (ps.length < 2) return;
    const [p1, p2] = ps;
    if (!p1.userId && !p2.userId) return; // skip if neither is authed

    let winnerId = null;
    if (payload.winner === p1.id) winnerId = p1.userId;
    else if (payload.winner === p2.id) winnerId = p2.userId;

    const durationMs = Date.now() - this.startTime;
    try {
      // Use the stats handler directly (same Worker context)
      const { handleRecordMatch } = await import('./stats.js');
      const body = JSON.stringify({
        mode: this.mode, roomCode: this.roomCode,
        isRanked: this.isRanked,
        p1Id: p1.userId, p2Id: p2.userId, winnerId,
        p1Score: p1.score, p2Score: p2.score,
        p1Lines: p1.lines, p2Lines: p2.lines,
        p1Stats: p1.stats, p2Stats: p2.stats, durationMs,
      });
      const fakeReq = new Request('https://internal/api/stats/record', {
        method: 'POST', body,
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': this.env.INTERNAL_KEY || '',
        },
      });
      const res  = await handleRecordMatch(fakeReq, this.env);
      const data = await res.json();
      return {
        eloDeltas: {
          [p1.id]: data.p1ELODelta || 0,
          [p2.id]: data.p2ELODelta || 0,
        },
        xpData: {
          [p1.id]: data.p1XP || null,
          [p2.id]: data.p2XP || null,
        },
      };
    } catch (e) { console.error('stats record failed:', e); return null; }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  opponent(playerId) {
    return [...this.players.values()].find(p => p.id !== playerId) || null;
  }

  mapPlayers() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name,
      username:    p.username    || '',
      displayName: p.displayName || '',
      elo:         p.elo,
      xp:          p.xp ?? null,
      ready: p.ready,
    }));
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      try { p.ws.send(s); } catch {}
    }
  }

  resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.cleanup(), ROOM_TIMEOUT_MS);
  }

  cleanup() {
    for (const p of this.players.values()) { try { p.ws.close(); } catch {} }
    this.players.clear();
  }
}
