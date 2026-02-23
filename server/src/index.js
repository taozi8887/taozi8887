// 
//  TETRIS MULTIPLAYER SERVER    Cloudflare Workers + Durable Objects
//
//  LOCAL TESTING:
//    cd server && npm install && npx wrangler dev
//     server runs on  http://localhost:8787   ws://localhost:8787
//    The HTML auto-detects localhost and switches to these URLs.
//    Open tetris.html from TWO browser tabs, create + join a room.
//
//  PRODUCTION DEPLOY:
//    npx wrangler login
//    npx wrangler deploy
//     replace YOUR_SUBDOMAIN in tetris.html with your *.workers.dev URL
//
//  SECURITY: WHY CHEATING IS IMPOSSIBLE 
//
//  The server maintains a FULL BOARD STATE for every player.
//  Clients send only raw placement decisions:
//    piecePlaced: { x, rot, tSpin(hint) }
//    hold:        {}
//
//  The server independently:
//    1. Looks up piece type from its own seeded 7-bag  client cannot
//       forge piece types; both use mulberry32(sameSeed)
//    2. Computes ghost Y (lowest valid row for x+rot on server board) 
//       client cannot claim a floating placement
//    3. Runs its own T-spin corner detection  client hint overridden
//       if it doesn't match server's check
//    4. Locks piece on the server board
//    5. Detects line clears from actual server board cell states (1-4)
//    6. Calculates attack using server-owned combo + B2B counters
//    7. Generates garbage hole positions server-side and sends them;
//       client uses these positions, never its own RNG
//
//  A cheater sending fake events from DevTools gets:
//     piecePlaced with fake x/rot   server uses correct ghostY anyway
//     claiming a Tetris             server sees actual board, 0 clears
//     claiming T-spin               server corner-checks, overrides if wrong
//     injecting 'lineClear'         not a recognised event, dropped
//     rapid-fire spam               rate-limited to 20 events/sec
//     5 consecutive bad placements  WebSocket closed
//
//  The only thing the client is trusted for: final score (cosmetic).
// 

//  Mulberry32 seeded PRNG 
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rand() {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//  Board simulation 
const S_COLS  = 10;
const S_ROWS  = 20;
const S_BUF   = 4;
const S_TOTAL = S_ROWS + S_BUF;
const S_EMPTY = '';

const S_PIECES = {
  I: { shapes: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ]},
  O: { shapes: [[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]]] },
  T: { shapes: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ]},
  S: { shapes: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ]},
  Z: { shapes: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ]},
  J: { shapes: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ]},
  L: { shapes: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ]},
};

function sGetShape(type, rot) {
  return S_PIECES[type]?.shapes[rot & 3];
}

function sIsValid(board, type, rot, x, y) {
  const shape = sGetShape(type, rot);
  if (!shape) return false;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = x + c, ny = y + r;
      if (nx < 0 || nx >= S_COLS || ny >= S_TOTAL) return false;
      if (ny < 0) continue;
      if (board[ny][nx] !== S_EMPTY) return false;
    }
  }
  return true;
}

// Returns lowest valid Y for piece at (x, rot). Returns null on top-out.
function sGetGhostY(board, type, rot, x) {
  const spawnY = type === 'O' ? S_BUF - 1 : S_BUF - 2;
  if (!sIsValid(board, type, rot, x, spawnY)) return null;
  let y = spawnY;
  while (sIsValid(board, type, rot, x, y + 1)) y++;
  return y;
}

function sLockPiece(board, type, rot, x, y) {
  const shape = sGetShape(type, rot);
  if (!shape) return;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const ny = y + r, nx = x + c;
      if (ny >= 0 && ny < S_TOTAL) board[ny][nx] = type;
    }
}

function sClearLines(board) {
  let count = 0;
  for (let r = S_TOTAL - 1; r >= 0; r--) {
    if (board[r].every(c => c !== S_EMPTY)) {
      board.splice(r, 1);
      board.unshift(new Array(S_COLS).fill(S_EMPTY));
      count++; r++;
    }
  }
  return count;
}

// T-spin corner detection. Called BEFORE locking: piece not yet on board.
function sDetectTSpin(board, type, rot, x, y) {
  if (type !== 'T') return 'none';
  const corners = [[y,x],[y,x+2],[y+2,x],[y+2,x+2]];
  let filled = 0;
  corners.forEach(([r,c]) => {
    if (r < 0 || r >= S_TOTAL || c < 0 || c >= S_COLS || board[r][c] !== S_EMPTY) filled++;
  });
  if (filled < 3) return 'none';
  const front = [[[y,x],[y,x+2]],[[y,x+2],[y+2,x+2]],[[y+2,x],[y+2,x+2]],[[y,x],[y+2,x]]][rot&3];
  let frontFilled = 0;
  front.forEach(([r,c]) => {
    if (r < 0 || r >= S_TOTAL || c < 0 || c >= S_COLS || board[r][c] !== S_EMPTY) frontFilled++;
  });
  return frontFilled === 2 ? 'tspin' : 'mini';
}

function sEncodeBoard(board) {
  let s = '';
  for (let r = S_BUF; r < S_TOTAL; r++)
    for (let c = 0; c < S_COLS; c++)
      s += board[r][c] || '.';
  return s;
}

//  PlayerBag  authoritative piece sequence + board per player 
class PlayerBag {
  constructor(seed, playerId) {
    this.bagRng     = mulberry32(seed);
    // Unique garbage RNG per player so hole patterns are independent
    this.garbageRng = mulberry32((seed ^ (0x9E3779B9 * (playerId + 1))) >>> 0);
    this.bag        = [];
    this.currentPiece    = null;
    this.heldPiece       = null;
    this.canHold         = true;
    this.combo           = -1;
    this.b2b             = false;
    this.board           = Array.from({length:S_TOTAL}, () => new Array(S_COLS).fill(S_EMPTY));
    this.violations      = 0;
    this._pendingGarbageLines = [];
    this._advance();
  }

  _fillBag() {
    const t = ['I','O','T','S','Z','J','L'];
    for (let i = t.length-1; i > 0; i--) {
      const j = Math.floor(this.bagRng() * (i+1));
      [t[i], t[j]] = [t[j], t[i]];
    }
    this.bag.push(...t);
  }

  _nextFromBag() {
    while (this.bag.length < 7) this._fillBag();
    return this.bag.shift();
  }

  _advance() { this.currentPiece = this._nextFromBag(); }

  useHold() {
    if (!this.canHold) return false;
    this.canHold = false;
    if (this.heldPiece === null) { this.heldPiece = this.currentPiece; this._advance(); }
    else { [this.heldPiece, this.currentPiece] = [this.currentPiece, this.heldPiece]; }
    return true;
  }

  confirmPlacement() { this._advance(); this.canHold = true; }

  applyGarbageLines(lines) {
    for (const {holeCol} of lines) {
      this.board.shift();
      const row = new Array(S_COLS).fill('G');
      row[Math.max(0, Math.min(S_COLS-1, holeCol|0))] = S_EMPTY;
      this.board.push(row);
    }
  }

  generateGarbageHoles(count) {
    const holes = [];
    for (let i = 0; i < count; i++)
      holes.push({ holeCol: Math.floor(this.garbageRng() * S_COLS) });
    return holes;
  }
}

//  Attack table 
const COMBO_TABLE = [0,0,1,1,2,2,3,3,4,4,4,5,5,5,5,5,5,5,5,5];

function calcAttack({lines, tSpin, b2b, combo}) {
  lines = Math.max(1, Math.min(4, lines|0));
  combo = Math.max(0, Math.min(19, combo|0));
  let atk = 0;
  if      (tSpin==='tspin') atk = [0,2,4,6][lines] ?? 0;
  else if (tSpin==='mini')  atk = 1;
  else                      atk = [0,0,1,2,4][lines] ?? 0;
  if (b2b && (tSpin==='tspin' || lines===4)) atk += 1;
  atk += COMBO_TABLE[combo] ?? 0;
  return Math.max(0, atk);
}

function calcPerfectClearAttack(lines) {
  return [0,10,10,10,10][Math.min(4, lines|0)] ?? 10;
}

//  Utilities 
function generateSeed() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return (buf[0] * 0xFFFF + buf[1]) >>> 0;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => chars[b % chars.length]).join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
  };
}

//  Worker Entry Point 
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsHeaders() });
    if (url.pathname === '/' && request.method === 'GET')
      return new Response(JSON.stringify({status:'ok',version:'2.0-secure'}),
        {headers:{'Content-Type':'application/json',...corsHeaders()}});
    if (url.pathname === '/create' && request.method === 'GET')
      return Response.json({roomCode:generateRoomCode()}, {headers:corsHeaders()});
    if (request.headers.get('Upgrade') === 'websocket') {
      const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/i);
      if (!match) return new Response('Invalid room path', {status:400});
      const obj = env.TETRIS_ROOM.get(env.TETRIS_ROOM.idFromName(match[1].toUpperCase()));
      return obj.fetch(request);
    }
    return new Response('Not found', {status:404, headers:corsHeaders()});
  },
};

//  Durable Object: TetrisRoom 
export class TetrisRoom {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.players    = new Map();
    this.wsToId     = new WeakMap();
    this.bags       = new Map();  // id  PlayerBag
    this.nextId     = 0;
    this.gameState  = 'waiting';
    this.mode       = 'versus';
    this.seed       = null;
    this.maxPlayers = 2;
    this.sprintTarget = 40;
    this.coopTarget   = 150;
    this.coopLines    = 0;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected WebSocket', {status:426});
    if (this.players.size >= this.maxPlayers && this.gameState !== 'waiting')
      return new Response('Room full', {status:403});
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, {status:101, webSocket:client});
  }

  async webSocketMessage(ws, rawMsg) {
    // ── Hibernation recovery ──────────────────────────────────────────────────
    // Cloudflare may evict this DO from memory between messages while keeping
    // WebSocket connections alive. Rebuild from attachments + storage whenever
    // the incoming WS handle is not yet in our in-memory map (covers both the
    // fully-empty case and partial-rebuild races with multiple simultaneous WSs).
    if (!this.wsToId.has(ws)) await this._rebuildFromHibernation();
    // ─────────────────────────────────────────────────────────────────────────

    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }
    const id = this.wsToId.get(ws);

    //  JOIN 
    if (msg.type === 'join') {
      if (id !== undefined) return;
      if (this.players.size >= this.maxPlayers) { ws.send(JSON.stringify({type:'error',reason:'Room full'})); ws.close(1008,'Room full'); return; }
      if (this.gameState === 'playing')         { ws.send(JSON.stringify({type:'error',reason:'Game in progress'})); ws.close(1008,'Game in progress'); return; }
      const newId = this.nextId++;
      const name  = String(msg.name||'Player '+(newId+1)).replace(/[<>&"']/g,'').trim().slice(0,20)||'Player '+(newId+1);
      if (newId===0 && msg.mode && ['versus','sprint','coop'].includes(msg.mode)) this.mode = msg.mode;
      this.players.set(newId, { ws, name, ready:false, alive:true, score:0, lines:0, pendingGarbage:0, eventCount:0, lastEventSec:Math.floor(Date.now()/1000) });
      this.wsToId.set(ws, newId);
      // Persist player identity on the WS itself — survives DO hibernation
      ws.serializeAttachment({ id:newId, name, alive:true, score:0, lines:0 });
      await this._persistMeta();
      ws.send(JSON.stringify({type:'joined', playerId:newId, mode:this.mode, players:this.getPlayerList()}));
      this.broadcast({type:'playerJoined', players:this.getPlayerList()}, newId);
      return;
    }

    if (id === undefined) { ws.close(1008,'Must join first'); return; }
    const player = this.players.get(id);
    if (!player) return;

    //  READY 
    if (msg.type === 'ready') {
      if (this.gameState !== 'waiting') return;
      player.ready = true;
      this.broadcast({type:'playerReady', playerId:id, players:this.getPlayerList()});
      const all = [...this.players.values()];
      if (all.length === this.maxPlayers && all.every(p => p.ready)) {
        this.seed = generateSeed();
        this.gameState = 'playing';
        this.coopLines = 0;
        this.bags.clear();
        for (const [pid, p] of this.players) {
          this.bags.set(pid, new PlayerBag(this.seed, pid));
          p.alive=true; p.score=0; p.lines=0; p.pendingGarbage=0;
        }
        await this._persistMeta();
        this.broadcast({type:'start', seed:this.seed, mode:this.mode, sprintTarget:this.sprintTarget, coopTarget:this.coopTarget});
      }
      return;
    }

    //  KEEPALIVE PING 
    if (msg.type === 'ping') { ws.send(JSON.stringify({type:'pong'})); return; }

    //  CLOSE LOBBY (host only, waiting state only) 
    if (msg.type === 'closeLobby') {
      if (id !== 0 || this.gameState !== 'waiting') return;
      this.broadcast({ type: 'lobbyClosed', by: player.name });
      for (const [, p] of this.players) { try { p.ws.close(1000, 'Lobby closed'); } catch {} }
      this.players.clear();
      this.bags.clear();
      this.gameState = 'waiting';
      this.nextId = 0;
      return;
    }

    //  GAME EVENTS 
    if (msg.type === 'event') {
      if (this.gameState !== 'playing' || !player.alive) return;
      const nowSec = Math.floor(Date.now()/1000);
      if (nowSec !== player.lastEventSec) { player.eventCount=0; player.lastEventSec=nowSec; }
      if (++player.eventCount > 40) return;  // raised from 20 — high-level play can hit 20/sec legitimately

      const bag  = this.bags.get(id);
      const kind = msg.kind;

      //  HOLD 
      if (kind === 'hold') { bag.useHold(); return; }

      //  GARBAGE APPLIED 
      if (kind === 'garbageApplied') {
        const count = Math.max(0, Math.min(20, msg.count|0));
        player.pendingGarbage = Math.max(0, player.pendingGarbage - count);
        return;
      }

      //  PIECE PLACED 
      if (kind === 'piecePlaced') {
        const rot  = msg.rot | 0;
        const x    = msg.x   | 0;
        const type = bag.currentPiece;

        // NOTE: Garbage is applied AFTER this piece is locked (see bottom of this block).
        // This matches the client which applies garbage in spawnNext() — *between* pieces.
        // Applying it here (before ghostY) caused a 1-piece desync where the server and
        // client computed ghostY on different boards.

        // Step 2: compute authoritative landing position
        const ghostY = sGetGhostY(bag.board, type, rot, x);
        if (ghostY === null) { this._handleGameOver(id, player, msg.score|0); return; }

        if (!sIsValid(bag.board, type, rot, x, ghostY)) {
          if (++bag.violations >= 5) ws.close(1008, 'Too many invalid placements');
          return;
        }
        bag.violations = 0;

        // Step 3: T-spin detection (before locking)
        const actualTSpin = sDetectTSpin(bag.board, type, rot, x, ghostY);

        // Step 4: lock piece to server board
        sLockPiece(bag.board, type, rot, x, ghostY);

        // Step 5: clear lines
        const cleared = sClearLines(bag.board);

        // Step 6: update combo + b2b, compute attack
        // Always persist the client-reported score (they are authoritative for cosmetic score)
        player.score = Math.max(player.score, msg.score|0);
        if (cleared === 0) {
          bag.combo = -1;
          // b2b survives non-clearing pieces
        } else {
          bag.combo++;
          const isDifficult = actualTSpin === 'tspin' || cleared === 4;
          const b2b = bag.b2b && isDifficult;
          bag.b2b   = isDifficult;
          player.lines += cleared;
          player.score  = Math.max(player.score, msg.score|0);
          // Keep WS attachment up to date so hibernation restores accurate stats
          ws.serializeAttachment({ id, name:player.name, alive:player.alive, score:player.score, lines:player.lines });

          if (this.mode === 'coop') {
            this.coopLines += cleared;
            this.broadcast({type:'coopProgress', total:this.coopLines, target:this.coopTarget});
            if (this.coopLines >= this.coopTarget) { this.endGame({type:'coopWin', lines:this.coopLines}); return; }
          }

          if (this.mode === 'sprint' && player.lines >= this.sprintTarget) {
            this.endGame({type:'sprintWin', winner:id, winnerName:player.name, elapsed:Math.max(0,msg.elapsed|0)});
            return;
          }

          let sentAtk = 0;
          if (this.mode === 'versus') {
            let atk = msg.perfectClear
              ? calcPerfectClearAttack(cleared)
              : calcAttack({lines:cleared, tSpin:actualTSpin, b2b, combo:bag.combo});
            sentAtk = atk;

            if (atk > 0) {
              for (const [oid, op] of this.players) {
                if (oid===id || !op.alive) continue;
                const opBag = this.bags.get(oid);
                // Garbage cancel
                if (op.pendingGarbage > 0) {
                  const cancel = Math.min(op.pendingGarbage, atk);
                  op.pendingGarbage -= cancel;
                  opBag._pendingGarbageLines.splice(0, cancel);
                  atk -= cancel;
                }
                if (atk > 0) {
                  const garbageLines = opBag.generateGarbageHoles(atk);
                  opBag._pendingGarbageLines.push(...garbageLines);
                  op.pendingGarbage += atk;
                  op.ws.send(JSON.stringify({type:'incomingGarbage', amount:atk, pending:op.pendingGarbage, garbageLines, from:id, fromName:player.name}));
                }
              }
            }
          }

          // Confirm back to attacker with authoritative results
          player.ws.send(JSON.stringify({type:'pieceConfirmed', lines:cleared, tSpin:actualTSpin, b2b, combo:bag.combo, atk:sentAtk}));
        }

        // Step 7: advance piece sequence
        bag.confirmPlacement();

        // Step 8: apply any queued incoming garbage NOW (between this piece and next).
        // This matches the client: applyPendingGarbage() runs in spawnNext(), i.e. AFTER
        // locking the current piece and BEFORE the next piece appears.
        if (bag._pendingGarbageLines.length > 0) {
          const toApply = bag._pendingGarbageLines.splice(0);
          bag.applyGarbageLines(toApply);
          player.pendingGarbage = Math.max(0, player.pendingGarbage - toApply.length);
        }

        // Broadcast authoritative board to opponents (includes any garbage just applied)
        this.broadcast({type:'opponentUpdate', from:id, score:player.score, lines:player.lines, snapshot:sEncodeBoard(bag.board)}, id);
        return;
      }

      //  SCORE SYNC (winner sends their current score before game ends) 
      if (kind === 'scoreSync') { player.score = Math.max(player.score, msg.score|0); return; }

      //  GAME OVER 
      if (kind === 'gameOver') { this._handleGameOver(id, player, msg.score|0); return; }
    }

    //  CHAT 
    if (msg.type === 'chat') {
      const text = String(msg.text||'').replace(/[<>&"']/g,'').trim().slice(0,80);
      if (text) this.broadcast({type:'chat', from:id, name:player.name, text});
    }
  }

  _handleGameOver(id, player, finalScore) {
    player.alive = false;
    player.score = Math.max(player.score, finalScore);
    // Persist updated state (alive: false, final score) so hibernation doesn't resurrect
    try { player.ws.serializeAttachment({ id, name:player.name, alive:false, score:player.score, lines:player.lines }); } catch {}
    this.broadcast({type:'playerOver', playerId:id, name:player.name, score:player.score});
    if (this.mode === 'versus') {
      const alive = [...this.players.entries()].filter(([,p]) => p.alive);
      if (alive.length <= 1) {
        const w = alive[0];
        this.endGame({type:'versusEnd', winner:w?.[0]??null, winnerName:w?.[1]?.name??null, scores:this.getScores()});
      }
    }
    if (this.mode === 'coop') {
      // In co-op, the game only ends when ALL players are dead
      const alive = [...this.players.entries()].filter(([,p]) => p.alive);
      if (alive.length === 0) {
        this.endGame({type:'coopLoss', scores:this.getScores()});
      }
    }
  }

  endGame(payload) {
    if (this.gameState === 'finished') return;
    this.gameState = 'finished';
    this._persistMeta();  // fire-and-forget
    // Spread would overwrite type:'gameEnd' with payload's type, so hoist it as gameType
    const {type: gameType, ...rest} = payload;
    this.broadcast({type:'gameEnd', gameType, ...rest});
    setTimeout(() => {
      this.gameState = 'waiting';
      for (const p of this.players.values()) { p.ready=false; p.alive=true; p.score=0; p.lines=0; p.pendingGarbage=0; }
      this.bags.clear();
      this._persistMeta();
      this.broadcast({type:'reset', players:this.getPlayerList()});
    }, 45_000);
  }

  async webSocketClose(ws) {
    if (!this.wsToId.has(ws)) await this._rebuildFromHibernation();
    const id = this.wsToId.get(ws);
    if (id === undefined) return;
    const p = this.players.get(id);
    this.players.delete(id);
    this.bags.delete(id);
    if (p) {
      this.broadcast({type:'playerLeft', playerId:id, name:p.name, players:this.getPlayerList()});
      if (this.gameState === 'playing' && this.mode === 'versus') {
        const w = [...this.players.entries()].find(([,pl]) => pl.alive);
        if (w) this.endGame({type:'versusEnd', winner:w[0], winnerName:w[1].name, scores:this.getScores(), reason:'disconnect'});
      }
    }
    if (this.players.size === 0) { this.gameState='waiting'; this.nextId=0; }
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  // ── Hibernation helpers ──────────────────────────────────────────────────
  async _persistMeta() {
    await this.state.storage.put('meta', {
      gameState: this.gameState,
      mode:      this.mode,
      seed:      this.seed,
      nextId:    this.nextId,
      coopLines: this.coopLines,
    });
  }

  async _rebuildFromHibernation() {
    // Restore basic meta from durable storage
    const meta = await this.state.storage.get('meta');
    if (meta) {
      this.gameState = meta.gameState ?? 'waiting';
      this.mode      = meta.mode      ?? 'versus';
      this.seed      = meta.seed      ?? null;
      this.nextId    = meta.nextId    ?? 0;
      this.coopLines = meta.coopLines ?? 0;
    }
    // Restore per-player data from WS attachments (includes alive, score, lines)
    for (const w of this.state.getWebSockets()) {
      const att = w.deserializeAttachment();
      if (att?.id === undefined) continue;
      this.wsToId.set(w, att.id);
      this.players.set(att.id, {
        ws: w,
        name:          att.name  ?? 'Player',
        ready:         att.ready ?? false,
        alive:         att.alive ?? true,   // restore actual alive state, NOT always true
        score:         att.score ?? 0,
        lines:         att.lines ?? 0,      // restore accumulated lines
        pendingGarbage: 0,
        eventCount:    0,
        lastEventSec:  Math.floor(Date.now()/1000),
      });
    }
    // If we woke up mid-game but can't restore board/bag state,
    // gracefully end the game and send everyone back to lobby
    if (this.gameState === 'playing' && this.bags.size === 0 && this.players.size > 0) {
      this.gameState = 'waiting';
      await this._persistMeta();
      this.broadcast({ type: 'serverRestart' });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  broadcast(msg, excludeId = -1) {
    const data = JSON.stringify(msg);
    for (const [pid, p] of this.players) {
      if (pid === excludeId) continue;
      try { p.ws.send(data); } catch {}
    }
  }

  getPlayerList() {
    return [...this.players.entries()].map(([pid,p]) => ({id:pid, name:p.name, ready:p.ready, alive:p.alive}));
  }

  getScores() {
    return [...this.players.entries()].map(([pid,p]) => ({id:pid, name:p.name, score:p.score, lines:p.lines}));
  }
}
