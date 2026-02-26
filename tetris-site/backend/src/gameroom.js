//  GameRoom 
// In-memory Socket.io equivalent of the Cloudflare GameRoom Durable Object.
// Handles one multiplayer room.

import { calcElo } from './elo.js';

const ROOM_TIMEOUT_MS       = 5 * 60 * 1000;
const START_COUNTDOWN_MS    = 1000;
const SPRINT_TARGET_DEFAULT = 40;
const COOP_TARGET_DEFAULT   = 150;
const MAX_PENDING_GARBAGE   = 20;

const VERSUS_ATK  = [0, 0, 1, 2, 4];
const TSPIN_ATK   = [0, 2, 4, 6];
const B2B_BONUS   = 1;
const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

// XP formula (mirrors stats.js)
function calcXpGain({ lines, tetrises, tSpins, durationMs, isWinner, mode }) {
  let xp = 20
    + lines * 5
    + tetrises * 10
    + tSpins * 8
    + Math.floor((durationMs || 0) / 5000);
  if (isWinner) {
    if (mode === 'versus') xp += 100;
    else if (mode === 'sprint') xp += 80;
    else if (mode === 'coop') xp += 60;
  }
  return Math.max(1, Math.round(xp));
}
function getLevel(xp) {
  if (xp <= 0) return 1;
  return Math.max(1, Math.floor((-350 + Math.sqrt(202500 + 200 * xp)) / 100));
}

export class GameRoom {
  constructor(roomCode, io, rooms, activegame, supabase, online) {
    this.roomCode   = roomCode;
    this.io         = io;
    this.rooms      = rooms;
    this.activegame = activegame;
    this.supabase   = supabase;
    this._online    = online;

    this.players    = new Map();   // socketId  player
    this.spectators = new Map();   // socketId  spectator
    this.nextId     = 0;
    this.started    = false;
    this.finished   = false;
    this.mode       = 'versus';
    this.isRanked   = true;
    this.seed       = 0;
    this.sharedLevel   = 1;
    this.sprintTarget  = SPRINT_TARGET_DEFAULT;
    this.coopTarget    = COOP_TARGET_DEFAULT;
    this.coopLines     = 0;
    this.startTime     = 0;
    this._startTimer   = null;
    this._idleTimer    = setTimeout(() => this._cleanup(), ROOM_TIMEOUT_MS);
  }

  hasSocket(socket) {
    return this.players.has(socket.id) || this.spectators.has(socket.id);
  }

  //  handleJoin 
  handleJoin(socket, data) {
    this._resetIdle();

    // Spectator path
    if (data.spectator) {
      this.spectators.set(socket.id, { socket, name: data.name || 'Spectator' });
      socket.join(this.roomCode);
      socket.emit('joined', {
        roomCode:   this.roomCode,
        spectator:  true,
        started:    this.started,
        mode:       this.mode,
        isRanked:   this.isRanked,
        players:    this._mapPlayers(),
      });
      this._broadcastRoom('spectatorCount', { count: this.spectators.size });
      if (this.started) {
        // Send current board state to new spectator
        for (const [, p] of this.players) {
          if (p.board) socket.emit('spectatorUpdate', { playerId: p.id, board: p.board, score: p.score, lines: p.lines });
        }
      }
      return;
    }

    // Too many players
    if (this.players.size >= 2) {
      return socket.emit('error', { reason: 'Room is full.' });
    }
    // Game already in progress
    if (this.started && !this.finished) {
      return socket.emit('error', { reason: 'Game already started.' });
    }

    const playerId = ++this.nextId;
    const player = {
      id:           playerId,
      socketId:     socket.id,
      socket,
      name:         data.name || data.username || 'Player',
      userId:       data.userId   || null,
      username:     data.username || '',
      displayName:  data.displayName || data.display_name || '',
      elo:          typeof data.elo === 'number' ? data.elo : 1000,
      xp:           typeof data.xp  === 'number' ? data.xp  : 0,
      ready:        false,
      over:         false,
      score:        0,
      lines:        0,
      tetrises:     0,
      tSpins:       0,
      maxCombo:     0,
      b2bMax:       0,
      garbageSent:  0,
      pendingGarbage: 0,
      board:        null,
      combo:        -1,
      b2bChain:     -1,
    };

    // Set room mode from first player
    if (this.players.size === 0) {
      this.mode     = data.mode     || 'versus';
      this.isRanked = data.isRanked !== false;
      this.sprintTarget = data.sprintTarget || SPRINT_TARGET_DEFAULT;
      this.coopTarget   = data.coopTarget   || COOP_TARGET_DEFAULT;
    }

    this.players.set(socket.id, player);
    socket.join(this.roomCode);

    // Track active game
    if (player.userId) this.activegame.set(player.userId, this.roomCode);

    socket.emit('joined', {
      playerId:   player.id,
      roomCode:   this.roomCode,
      mode:       this.mode,
      isRanked:   this.isRanked,
      players:    this._mapPlayers(),
    });
    this._broadcastRoom('playerJoined', { players: this._mapPlayers() }, socket);

    // If room now has 2 players and was reset/finished, reset finished flag
    if (this.finished) this.finished = false;
  }

  //  handleReady 
  handleReady(socket) {
    const player = this.players.get(socket.id);
    if (!player || this.started) return;
    player.ready = true;
    this._broadcastRoom('playerReady', { playerId: player.id, players: this._mapPlayers() });

    const allReady = [...this.players.values()].every(p => p.ready);
    if (allReady && this.players.size === 2) {
      clearTimeout(this._startTimer);
      this._startTimer = setTimeout(() => this._startGame(), START_COUNTDOWN_MS);
    }
  }

  //  handleEvent 
  handleEvent(socket, data) {
    const player = this.players.get(socket.id);
    if (!player || !this.started || player.over) return;

    // Client sends `kind`, legacy/future may send `eventType`
    const eventType = data.eventType ?? data.kind;

    if (eventType === 'piecePlaced') {
      const { score = 0 } = data;
      // Normalise field names (client sends `lines`, not `linesCleared`)
      const linesCleared = data.linesCleared ?? data.lines ?? 0;
      const isRealTSpin  = data.tSpin === 'tspin';

      player.score = score;
      player.lines += linesCleared;

      // Server-side combo tracking
      if (linesCleared > 0) player.combo++; else player.combo = -1;
      // Server-side B2B tracking  (Tetris or T-Spin with lines)
      const isDifficult = linesCleared === 4 || (isRealTSpin && linesCleared > 0);
      if (isDifficult)         player.b2bChain++;
      else if (linesCleared > 0) player.b2bChain = -1;

      // Accumulate stats
      if (linesCleared === 4 && !isRealTSpin) player.tetrises++;
      if (isRealTSpin && linesCleared > 0)   player.tSpins++;
      if (player.combo > player.maxCombo)    player.maxCombo = player.combo;
      if (player.b2bChain > player.b2bMax)   player.b2bMax  = player.b2bChain;

      // Attack calculation (versus only)
      if (this.mode === 'versus') {
        let attack = 0;
        if (isRealTSpin) {
          attack = TSPIN_ATK[Math.min(linesCleared, TSPIN_ATK.length - 1)] || 0;
        } else {
          attack = VERSUS_ATK[Math.min(linesCleared, VERSUS_ATK.length - 1)] || 0;
        }
        if (player.b2bChain > 0 && attack > 0) attack += B2B_BONUS;
        if (attack > 0 && player.combo > 1)
          attack += COMBO_TABLE[Math.min(player.combo, COMBO_TABLE.length - 1)];

        const opp = this._opponent(player.id);
        if (opp && attack > 0) {
          // Garbage cancellation
          if (opp.pendingGarbage > 0) {
            const cancel = Math.min(attack, opp.pendingGarbage);
            opp.pendingGarbage -= cancel;
            attack -= cancel;
          }
          if (attack > 0) {
            const toSend = Math.min(MAX_PENDING_GARBAGE - opp.pendingGarbage, attack);
            if (toSend > 0) {
              opp.pendingGarbage = Math.min(MAX_PENDING_GARBAGE, opp.pendingGarbage + toSend);
              player.garbageSent += toSend;
              // Generate hole column positions (same col per batch, shifts feel natural)
              const holeCol = Math.floor(Math.random() * 10);
              const garbageLines = Array.from({ length: toSend }, () => ({ holeCol }));
              opp.socket.emit('incomingGarbage', {
                lines:        toSend,
                pending:      opp.pendingGarbage,
                garbageLines,
                fromName:     player.username || player.displayName || 'Opponent',
              });
            }
          }
        }
      }

      // Sprint / Coop progress
      if (this.mode === 'sprint') {
        player.socket.emit('sprintProgress', { lines: player.lines, target: this.sprintTarget });
        if (player.lines >= this.sprintTarget) {
          this._endGame({ winnerId: player.userId, reason: 'sprint' });
          return;
        }
      }
      if (this.mode === 'coop') {
        this.coopLines = [...this.players.values()].reduce((s, p) => s + p.lines, 0);
        this._broadcastRoom('coopProgress', { lines: this.coopLines, target: this.coopTarget });
        if (this.coopLines >= this.coopTarget) {
          this._endGame({ winnerId: null, reason: 'coop_win' });
          return;
        }
      }

      // Gravity sync — shared level so both players always have the same speed
      if (this.mode === 'coop') {
        const newLevel = Math.floor(this.coopLines / 10) + 1;
        if (newLevel > this.sharedLevel) {
          this.sharedLevel = newLevel;
          this._broadcastRoom('gravitySync', { level: this.sharedLevel });
        }
      } else if (this.mode === 'versus') {
        // Use the higher of both players' individual levels as the shared level
        const maxLines = Math.max(...[...this.players.values()].map(p => p.lines));
        const newLevel = Math.floor(maxLines / 10) + 1;
        if (newLevel > this.sharedLevel) {
          this.sharedLevel = newLevel;
          this._broadcastRoom('gravitySync', { level: this.sharedLevel });
        }
      }

      // Opponent board update
      const opp = this._opponent(player.id);
      if (opp) {
        opp.socket.emit('opponentUpdate', {
          playerId: player.id,
          score:    player.score,
          lines:    player.lines,
          pending:  opp.pendingGarbage,
          snapshot: player.board,   // include last known board snapshot
        });
      }

      // Confirm piece to sender
      socket.emit('pieceConfirmed', { score: player.score, lines: player.lines });
    }

    else if (eventType === 'gameOver') {
      player.over = true;
      const opp = this._opponent(player.id);
      // Notify opponent immediately (before the async DB work in _endGame)
      if (opp) {
        opp.socket.emit('playerOver', { playerId: player.id, name: player.displayName || player.name });
      }
      if (!this.finished) {
        const winnerId = opp?.userId || null;
        this._endGame({ winnerId, reason: 'gameover', loser: player });
      }
    }

    else if (eventType === 'scoreSync') {
      player.score = data.score ?? player.score;
      player.lines = data.lines ?? player.lines;
    }

    else if (eventType === 'garbageApplied') {
      // Client sends `count`, normalise to `lines`
      player.pendingGarbage = Math.max(0, player.pendingGarbage - (data.lines ?? data.count ?? 0));
    }

    else if (eventType === 'boardHeartbeat') {
      // Client sends `snapshot`, server also accepts `board`
      const board = data.board ?? data.snapshot;
      player.board = board;
      // Forward to opponent for live board mirroring
      const opp = this._opponent(player.id);
      if (opp) {
        opp.socket.emit('opponentUpdate', {
          playerId: player.id,
          score:    player.score,
          lines:    player.lines,
          pending:  opp.pendingGarbage,
          snapshot: board,
        });
      }
      // Relay to spectators
      for (const [, spec] of this.spectators) {
        spec.socket.emit('spectatorUpdate', {
          playerId: player.id,
          board,
          score: player.score,
          lines: player.lines,
        });
      }
    }
  }

  //  handleChat 
  handleChat(socket, text) {
    const player = this.players.get(socket.id);
    if (!player) return;
    const safeText = String(text || '').slice(0, 200);
    this._broadcastRoom('chat', { name: player.name, text: safeText });
  }

  //  handleCloseLobby 
  async handleCloseLobby(socket) {
    const player = this.players.get(socket.id);
    if (!player || player.id !== 1) return; // only host
    const opp = [...this.players.values()].find(p => p.id !== 1);
    this._broadcastRoom('lobbyClosed', {});
    await this._cancelChallengeForRoom(opp?.userId);
    this._cleanup();
  }

  //  handleDisconnect 
  async handleDisconnect(socket) {
    // Spectator
    if (this.spectators.has(socket.id)) {
      this.spectators.delete(socket.id);
      this._broadcastRoom('spectatorCount', { count: this.spectators.size });
      return;
    }

    const player = this.players.get(socket.id);
    if (!player) return;

    // Clear presence
    if (player.userId) this.activegame.delete(player.userId);

    if (this.started && !this.finished) {
      // Mid-game disconnect  void if ranked
      this._endGame({ winnerId: null, reason: 'disconnect', disconnected: player });
    } else {
      const opp = [...this.players.values()].find(p => p !== player);
      this.players.delete(socket.id);
      this._broadcastRoom('playerLeft', { playerId: player.id, players: this._mapPlayers() });
      if (opp) await this._cancelChallengeForRoom(opp.userId);
      if (this.players.size === 0) this._cleanup();
    }
  }

  //  _cancelChallengeForRoom 
  async _cancelChallengeForRoom(notifyUserId) {
    try {
      await this.supabase
        .from('challenges')
        .update({ status: 'cancelled' })
        .eq('room_code', this.roomCode)
        .in('status', ['pending', 'accepted']);
    } catch (err) {
      console.error('_cancelChallengeForRoom error:', err);
    }
    if (notifyUserId && this._online) {
      const sid = this._online.get(notifyUserId);
      if (sid) this.io.to(sid).emit('challenge_cancelled', { roomCode: this.roomCode });
    }
  }

  //  _startGame 
  _startGame() {
    if (this.players.size < 2) return;
    this.started   = true;
    this.finished  = false;
    this.seed      = Math.floor(Math.random() * 2 ** 31);
    this.startTime = Date.now();
    this.coopLines = 0;
    this.sharedLevel = 1;

    for (const [, p] of this.players) {
      p.over = false; p.score = 0; p.lines = 0;
      p.tetrises = 0; p.tSpins = 0; p.maxCombo = 0; p.b2bMax = 0;
      p.garbageSent = 0; p.pendingGarbage = 0; p.board = null;
      p.combo = -1; p.b2bChain = -1;
    }

    this._broadcastAll('start', {
      seed:          this.seed,
      mode:          this.mode,
      isRanked:      this.isRanked,
      sprintTarget:  this.sprintTarget,
      coopTarget:    this.coopTarget,
      players:       this._mapPlayers(),
    });
  }

  //  _endGame 
  async _endGame({ winnerId, reason, disconnected } = {}) {
    if (this.finished) return;
    this.finished = true;

    const duration = Date.now() - (this.startTime || Date.now());
    const voidReason = reason === 'disconnect' ? 'disconnect' : null;

    // Clear presence for all
    for (const [, p] of this.players) {
      if (p.userId) this.activegame.delete(p.userId);
    }

    const ps = [...this.players.values()];
    let { eloDeltas, xpData } = { eloDeltas: {}, xpData: {} };

    try {
      ({ eloDeltas, xpData } = await this._recordMatchResult({
        winnerId, voidReason, duration, ps,
      }));
    } catch (err) {
      console.error('_recordMatchResult error:', err);
    }

    // Build userId → playerId map
    const userToPlayer = {};
    for (const [, p] of this.players) {
      if (p.userId) userToPlayer[p.userId] = p.id;
    }
    const winnerPlayerId = winnerId ? (userToPlayer[winnerId] ?? null) : null;

    let gameType = 'versusEnd';
    if (this.mode === 'sprint') {
      gameType = 'sprintWin';
    } else if (this.mode === 'coop') {
      gameType = (reason === 'coop_win') ? 'coopWin' : 'coopLoss';
    }

    const scores = [...this.players.values()].map(p => ({
      id:          p.id,
      name:        p.displayName || p.name,
      username:    p.username,
      score:       p.score || 0,
      lines:       p.lines || 0,
      garbageSent: p.garbageSent || 0,
      userId:      p.userId,
    }));

    const eloByPlayer = {};
    const xpByPlayer  = {};
    for (const [uid, d] of Object.entries(eloDeltas || {})) {
      const pid = userToPlayer[uid];
      if (pid != null) eloByPlayer[pid] = d;
    }
    for (const [uid, d] of Object.entries(xpData || {})) {
      const pid = userToPlayer[uid];
      if (pid != null) xpByPlayer[pid] = d;
    }

    const winnerObj  = [...this.players.values()].find(p => p.id === winnerPlayerId);
    const winnerName = winnerObj ? (winnerObj.displayName || winnerObj.name || '') : '';

    const endPayload = {
      gameType,
      winner:     winnerPlayerId,
      winnerName,
      isRanked:   this.isRanked,
      reason:     reason || null,
      scores,
      elapsed:    Math.round(duration / 1000),
      lines:      this.coopLines,
      eloDeltas:  eloByPlayer,
      xpData:     xpByPlayer,
      // Legacy fields
      winnerId,
      voidReason,
      duration,
      players:    this._mapPlayers(),
    };

    this._broadcastAll('gameEnd', endPayload);

    // Relay to spectators
    for (const [, spec] of this.spectators) {
      spec.socket.emit('spectatorGameEnd', endPayload);
    }

    // Reset after 5s
    setTimeout(() => {
      for (const [, p] of this.players) {
        p.ready = false; p.over = false;
      }
      this.started  = false;
      this.finished = false;
      this._broadcastRoom('reset', {});
    }, 5000);
  }

  //  _recordMatchResult 
  async _recordMatchResult({ winnerId, voidReason, duration, ps }) {
    if (ps.length < 2) return { eloDeltas: {}, xpData: {} };

    const [p1, p2] = ps;
    const eloDeltas = {};
    const xpData    = {};

    // ELO update (ranked versus only, no void)
    if (this.mode === 'versus' && this.isRanked && !voidReason && p1.userId && p2.userId) {
      const { data: u1 } = await this.supabase.from('users').select('elo, stats(versus_played)').eq('id', p1.userId).single();
      const { data: u2 } = await this.supabase.from('users').select('elo, stats(versus_played)').eq('id', p2.userId).single();
      if (u1 && u2) {
        const scoreA = winnerId === p1.userId ? 1 : winnerId === p2.userId ? 0 : 0.5;
        const result = calcElo(u1.elo, u2.elo, scoreA, u1.stats?.versus_played || 0, u2.stats?.versus_played || 0);
        eloDeltas[p1.userId] = result.deltaA;
        eloDeltas[p2.userId] = result.deltaB;

        await Promise.all([
          this.supabase.from('users').update({ elo: result.newA, updated_at: new Date().toISOString() }).eq('id', p1.userId),
          this.supabase.from('users').update({ elo: result.newB, updated_at: new Date().toISOString() }).eq('id', p2.userId),
        ]);
      }
    }

    // XP awards
    for (const p of ps) {
      if (!p.userId) continue;
      const isWinner = winnerId === p.userId;
      const xpGained = calcXpGain({ lines: p.lines, tetrises: p.tetrises, tSpins: p.tSpins, durationMs: duration, isWinner, mode: this.mode });
      const { data: uRow } = await this.supabase.from('users').select('xp').eq('id', p.userId).single();
      const oldXp  = uRow?.xp ?? 0;
      const newXp  = oldXp + xpGained;
      const oldLvl = getLevel(oldXp);
      const newLvl = getLevel(newXp);
      await this.supabase.from('users').update({ xp: newXp, updated_at: new Date().toISOString() }).eq('id', p.userId);
      xpData[p.userId] = { xpGained, xp: newXp, level: newLvl, leveledUp: newLvl > oldLvl };
    }

    // Stats updates
    for (const p of ps) {
      if (!p.userId) continue;
      const isWinner = winnerId === p.userId;
      await this._updateStats(p, isWinner, voidReason, duration);
    }

    // Insert match record
    const isRankedVersus = this.mode === 'versus' && this.isRanked;
    await this.supabase.from('matches').insert({
      room_code:      this.roomCode,
      mode:           this.mode,
      is_ranked:      this.isRanked,
      void_reason:    voidReason,
      p1_id:          p1.userId,
      p2_id:          p2.userId,
      winner_id:      winnerId,
      p1_score:       p1.score,
      p2_score:       p2.score,
      p1_lines:       p1.lines,
      p2_lines:       p2.lines,
      p1_garbage_sent: p1.garbageSent,
      p2_garbage_sent: p2.garbageSent,
      p1_elo_before:  null,
      p2_elo_before:  null,
      p1_elo_delta:   eloDeltas[p1.userId] ?? 0,
      p2_elo_delta:   eloDeltas[p2.userId] ?? 0,
      duration_ms:    duration,
      p1_final_board: p1.board || null,
      p2_final_board: p2.board || null,
    });

    return { eloDeltas, xpData };
  }

  //  _updateStats 
  async _updateStats(p, isWinner, voidReason, duration = 0) {
    const mode  = this.mode;
    const ranked = this.isRanked && !voidReason;

    const inc = {};

    inc.games_played   = 1;
    inc.total_lines    = p.lines;
    inc.total_score    = p.score;
    inc.total_pieces   = 0; // not tracked per-piece here
    inc.tetrises       = p.tetrises;
    inc.t_spins        = p.tSpins;
    inc.time_played_ms = duration;

    if (isWinner) inc.games_won = 1;
    else          inc.games_lost = 1;

    if (mode === 'versus' && ranked) {
      inc.versus_played          = 1;
      inc.versus_lines           = p.lines;
      inc.versus_tetrises        = p.tetrises;
      inc.versus_t_spins         = p.tSpins;
      inc.versus_time_played_ms  = duration;
      if (isWinner) inc.versus_won = 1;
    }
    if (mode === 'versus' && !ranked) {
      inc.casual_vs_played         = 1;
      inc.casual_vs_tetrises       = p.tetrises;
      inc.casual_vs_t_spins        = p.tSpins;
      inc.casual_vs_lines          = p.lines;
      inc.casual_vs_time_played_ms = duration;
      if (isWinner) inc.casual_vs_won = 1;
    }
    if (mode === 'sprint') {
      inc.sprint_played          = 1;
      inc.sprint_total_lines     = p.lines;
      inc.sprint_tetrises        = p.tetrises;
      inc.sprint_t_spins         = p.tSpins;
      inc.sprint_time_played_ms  = duration;
      if (isWinner) inc.sprint_won = 1;
    }
    if (mode === 'coop') {
      inc.coop_played          = 1;
      inc.coop_total_lines     = p.lines;
      inc.coop_tetrises        = p.tetrises;
      inc.coop_t_spins         = p.tSpins;
      inc.coop_time_played_ms  = duration;
      if (isWinner) inc.coop_won = 1;
    }

    // Fetch current row to compute bests
    const { data: cur } = await this.supabase.from('stats').select('*').eq('user_id', p.userId).single();

    const updates = {};
    for (const [col, delta] of Object.entries(inc)) {
      updates[col] = (cur?.[col] ?? 0) + delta;
    }
    // Global bests
    if (p.score    > (cur?.best_score  ?? 0)) updates.best_score  = p.score;
    if (p.lines    > (cur?.best_lines  ?? 0)) updates.best_lines  = p.lines;
    if (p.maxCombo > (cur?.max_combo   ?? 0)) updates.max_combo   = p.maxCombo;
    if ((p.b2bMax || 0) > (cur?.b2b_max ?? 0)) updates.b2b_max   = p.b2bMax;
    // Ranked versus bests
    if (mode === 'versus' && ranked) {
      if (p.score    > (cur?.versus_best_score ?? 0)) updates.versus_best_score = p.score;
      if (p.maxCombo > (cur?.versus_max_combo  ?? 0)) updates.versus_max_combo  = p.maxCombo;
      if ((p.b2bMax || 0) > (cur?.versus_b2b_max ?? 0)) updates.versus_b2b_max = p.b2bMax;
    }
    // Casual versus bests
    if (mode === 'versus' && !ranked) {
      if (p.score    > (cur?.casual_vs_best_score ?? 0)) updates.casual_vs_best_score = p.score;
      if (p.maxCombo > (cur?.casual_vs_max_combo  ?? 0)) updates.casual_vs_max_combo  = p.maxCombo;
      if ((p.b2bMax || 0) > (cur?.casual_vs_b2b_max ?? 0)) updates.casual_vs_b2b_max = p.b2bMax;
    }
    // Sprint bests
    if (mode === 'sprint') {
      if (p.score    > (cur?.sprint_best_score ?? 0)) updates.sprint_best_score = p.score;
      if (p.maxCombo > (cur?.sprint_max_combo  ?? 0)) updates.sprint_max_combo  = p.maxCombo;
      if ((p.b2bMax || 0) > (cur?.sprint_b2b_max ?? 0)) updates.sprint_b2b_max = p.b2bMax;
      // Sprint PB = fastest win time (lower is better)
      if (isWinner && duration > 0 && (!cur?.best_sprint_ms || duration < cur.best_sprint_ms))
        updates.best_sprint_ms = duration;
    }
    // Coop bests
    if (mode === 'coop') {
      if (p.score    > (cur?.coop_best_score ?? 0)) updates.coop_best_score = p.score;
      if (p.maxCombo > (cur?.coop_max_combo  ?? 0)) updates.coop_max_combo  = p.maxCombo;
      if ((p.b2bMax || 0) > (cur?.coop_b2b_max ?? 0)) updates.coop_b2b_max = p.b2bMax;
    }

    await this.supabase.from('stats').upsert({ user_id: p.userId, ...updates });
  }

  //  Helpers 
  _opponent(playerId) {
    for (const [, p] of this.players) {
      if (p.id !== playerId) return p;
    }
    return null;
  }

  _mapPlayers() {
    return [...this.players.values()].map(p => ({
      id:          p.id,
      name:        p.name,
      username:    p.username,
      displayName: p.displayName,
      elo:         p.elo,
      xp:          p.xp,
      ready:       p.ready,
      over:        p.over,
      score:       p.score,
      lines:       p.lines,
      userId:      p.userId,
    }));
  }

  _broadcastRoom(event, data, excludeSocket = null) {
    for (const [, p] of this.players) {
      if (excludeSocket && p.socket === excludeSocket) continue;
      p.socket.emit(event, data);
    }
  }

  _broadcastAll(event, data) {
    this.io.to(this.roomCode).emit(event, data);
  }

  _resetIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._cleanup(), ROOM_TIMEOUT_MS);
  }

  _cleanup() {
    clearTimeout(this._idleTimer);
    clearTimeout(this._startTimer);
    for (const [, p] of this.players) {
      if (p.userId) this.activegame.delete(p.userId);
    }
    this.rooms.delete(this.roomCode);
  }
}
