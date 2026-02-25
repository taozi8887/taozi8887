//  MatchmakingQueue 
// In-memory Socket.io equivalent of the Cloudflare MatchmakingQueue DO.
// Supports ranked/casual versus, sprint, and coop modes.
// Ranked matchmaking uses ELO range expansion over time.

const ELO_RANGE_START    = 100;
const ELO_RANGE_STEP     = 50;
const ELO_RANGE_INTERVAL = 15_000; // ms before range expands
const ELO_RANGE_MAX      = 600;
const SCAN_INTERVAL_MS   = 3_000;
const VALID_MODES        = ['ranked-versus', 'casual-versus', 'sprint', 'coop'];

export class MatchmakingQueue {
  constructor(io, rooms, activegame, supabase) {
    this.io         = io;
    this.rooms      = rooms;
    this.activegame = activegame;
    this.supabase   = supabase;

    // mode  [ { socket, userId, username, displayName, elo, xp, mode, joinedAt } ]
    this.queues = {};
    for (const m of VALID_MODES) this.queues[m] = [];

    // Periodic scan for compatible pairs
    setInterval(() => this._scanAll(), SCAN_INTERVAL_MS);
  }

  //  join 
  join(socket, data) {
    const mode = data?.mode || 'ranked-versus';
    if (!VALID_MODES.includes(mode)) {
      return socket.emit('error', { reason: 'Unknown queue mode.' });
    }
    // Prevent duplicate
    this.leave(socket);

    const entry = {
      socket,
      sessionId:   data.sessionId || socket.id,
      userId:      data.userId      || null,
      username:    data.username    || 'Player',
      displayName: data.displayName || data.display_name || '',
      elo:         typeof data.elo === 'number' ? data.elo : 1000,
      xp:          typeof data.xp  === 'number' ? data.xp  : 0,
      mode,
      joinedAt:    Date.now(),
    };

    this.queues[mode].push(entry);
    socket.emit('queueStatus', { status: 'searching', mode, position: this.queues[mode].length });

    // Try immediate match
    this._tryMatch(entry);
    this._sendStatusUpdates(mode);
  }

  //  leave 
  leave(socket) {
    for (const mode of VALID_MODES) {
      const prev = this.queues[mode].length;
      this.queues[mode] = this.queues[mode].filter(e => e.socket.id !== socket.id);
      if (this.queues[mode].length < prev) this._sendStatusUpdates(mode);
    }
  }

  //  _scanAll 
  _scanAll() {
    for (const mode of VALID_MODES) {
      this._scanMode(mode);
    }
  }

  _scanMode(mode) {
    const q = this.queues[mode];
    if (q.length < 2) return;

    // Sort by joinedAt (longest waiting first)
    q.sort((a, b) => a.joinedAt - b.joinedAt);

    const matched = new Set();
    for (let i = 0; i < q.length; i++) {
      if (matched.has(i)) continue;
      for (let j = i + 1; j < q.length; j++) {
        if (matched.has(j)) continue;
        if (this._isCompatible(q[i], q[j])) {
          this._createMatch(q[i], q[j]);
          matched.add(i);
          matched.add(j);
          break;
        }
      }
    }
    if (matched.size > 0) {
      this.queues[mode] = q.filter((_, idx) => !matched.has(idx));
      this._sendStatusUpdates(mode);
    }
  }

  //  _tryMatch 
  _tryMatch(newEntry) {
    const q = this.queues[newEntry.mode];
    for (let i = 0; i < q.length; i++) {
      if (q[i].socket.id === newEntry.socket.id) continue;
      if (this._isCompatible(newEntry, q[i])) {
        this._createMatch(newEntry, q[i]);
        this.queues[newEntry.mode] = q.filter(e =>
          e.socket.id !== newEntry.socket.id && e.socket.id !== q[i].socket.id
        );
        this._sendStatusUpdates(newEntry.mode);
        return;
      }
    }
  }

  //  _isCompatible 
  _isCompatible(a, b) {
    if (a.mode !== b.mode) return false;
    if (a.userId && b.userId && a.userId === b.userId) return false;

    // Casual modes: instant match (no ELO restriction)
    if (a.mode === 'casual-versus' || a.mode === 'sprint' || a.mode === 'coop') return true;

    // Ranked: ELO range check
    const now = Date.now();
    const rangeA = this._computeRange(a, now);
    const rangeB = this._computeRange(b, now);
    const allowedDelta = Math.max(rangeA, rangeB);
    return Math.abs(a.elo - b.elo) <= allowedDelta;
  }

  _computeRange(entry, now) {
    const waitSecs = (now - entry.joinedAt) / 1000;
    return Math.min(
      ELO_RANGE_MAX,
      ELO_RANGE_START + Math.floor((waitSecs * 1000) / ELO_RANGE_INTERVAL) * ELO_RANGE_STEP,
    );
  }

  //  _createMatch 
  _createMatch(p1, p2) {
    const roomCode  = Math.random().toString(36).slice(2, 8).toUpperCase();
    const isRanked  = p1.mode === 'ranked-versus';
    const gameMode  = ['ranked-versus', 'casual-versus'].includes(p1.mode) ? 'versus'
                    : p1.mode === 'sprint' ? 'sprint' : 'coop';

    const payload = (opp) => ({
      roomCode,
      gameMode,
      isRanked,
      opponentName:        opp.displayName || opp.username,
      opponentElo:         opp.elo,
      opponentDisplayName: opp.displayName || opp.username,
    });

    p1.socket.emit('matchFound', payload(p2));
    p2.socket.emit('matchFound', payload(p1));
  }

  //  _sendStatusUpdates 
  _sendStatusUpdates(mode) {
    const q = this.queues[mode];
    const now = Date.now();
    q.forEach((entry, i) => {
      entry.socket.emit('queueUpdate', {
        position:  i + 1,
        queueSize: q.length,
        eloDelta:  this._computeRange(entry, now),
        waitSecs:  Math.floor((now - entry.joinedAt) / 1000),
      });
    });
  }
}
