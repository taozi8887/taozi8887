//  Main Server 
// Node.js + Express + Socket.io + Supabase

import 'dotenv/config';
import express          from 'express';
import { createServer } from 'http';
import { Server }       from 'socket.io';
import cors             from 'cors';
import cookieParser     from 'cookie-parser';
import { createClient } from '@supabase/supabase-js';

// Fail fast if critical env vars are missing
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`[FATAL] Missing required environment variables: ${missingEnv.join(', ')}`);
  console.error('[FATAL] Storage and database operations will fail with RLS/auth errors without these.');
  process.exit(1);
}
import { GameRoom }     from './gameroom.js';
import { MatchmakingQueue } from './matchmaking.js';
import { router as authRouter    } from './auth.js';
import { router as profileRouter, initAvatarBucket } from './profile.js';
import { router as statsRouter   } from './stats.js';
import { router as friendsRouter } from './friends.js';

const app    = express();
const httpSv = createServer(app);

const CORS_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5500';

export const io = new Server(httpSv, {
  cors: {
    origin: (origin, cb) => cb(null, origin || CORS_ORIGIN),
    credentials: true,
  },
});

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
      detectSessionInUrl: false,
    },
  },
);

//  In-memory state 
export const rooms      = new Map();   // roomCode  GameRoom
export const online     = new Map();   // userId  socketId
export const activegame = new Map();   // userId  roomCode
export const mq = new MatchmakingQueue(io, rooms, activegame, supabase);

//  HTTP Middleware 
app.use(cors({
  origin: (origin, cb) => cb(null, origin || CORS_ORIGIN),
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

//  REST Routes 
app.use('/api/auth',    authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/stats',   statsRouter);
app.use('/api/friends', friendsRouter);

// GET /api/leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 25));
    const q     = (req.query.q || '').trim();
    const rank  = (req.query.rank || '').trim();
    const offset = (page - 1) * limit;

    // ELO range filter by rank name
    const RANK_RANGES = {
      Grandmaster: [2200, 99999],
      Master:      [2000, 2199],
      Diamond:     [1800, 1999],
      Platinum:    [1600, 1799],
      Gold:        [1400, 1599],
      Silver:      [1200, 1399],
      Bronze:      [1000, 1199],
      Unranked:    [0,     999],
    };

    let query = supabase
      .from('users')
      .select('id, username, display_name, elo, xp, profiles(avatar_url, country), stats(versus_played, versus_won)', { count: 'exact' })
      .order('elo', { ascending: false });

    if (q)    query = query.ilike('username', `%${q}%`);
    if (rank && RANK_RANGES[rank]) {
      query = query.gte('elo', RANK_RANGES[rank][0]).lte('elo', RANK_RANGES[rank][1]);
    }
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const entries = (data || []).map((u, i) => ({
      rank:           offset + i + 1,
      id:             u.id,
      username:       u.username,
      display_name:   u.display_name || '',
      elo:            u.elo ?? 1000,
      xp:             u.xp  ?? 0,
      avatar_url:     u.profiles?.avatar_url || null,
      country:        u.profiles?.country    || '',
      versus_played:  u.stats?.versus_played || 0,
      versus_won:     u.stats?.versus_won    || 0,
    }));

    res.json({ entries, total: count || 0, page, limit });
  } catch (err) {
    console.error('leaderboard:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/presence/room/:username
app.get('/api/presence/room/:username', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('id').eq('username', req.params.username).single();
  if (!user) return res.json({ active: false, roomCode: null });
  const roomCode = activegame.get(user.id) || null;
  res.json({ active: !!roomCode, roomCode });
});

// GET /api/presence/online-count
app.get('/api/presence/online-count', (_req, res) => {
  res.json({ online: online.size });
});

// GET /create  generate a fresh room code
app.get('/create', (_req, res) => {
  const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  res.json({ roomCode });
});

// GET /room/:roomCode  check if room exists / is joinable
app.get('/room/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  res.json({ exists: true, roomCode });
});

// GET /health
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

//  Socket.io 
io.on('connection', (socket) => {
  //  Game Room 
  socket.on('joinRoom', async (data) => {
    const roomCode = (data.roomCode || data.room_code || '').toUpperCase().trim();
    if (!roomCode) return socket.emit('error', { reason: 'Missing roomCode.' });
    // Verify email before allowing multiplayer
    const userId = data.userId || data.user_id;
    if (userId) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      if (!authUser?.user?.email_confirmed_at) {
        return socket.emit('error', { reason: 'Please verify your email address before playing multiplayer.' });
      }
    }
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, new GameRoom(roomCode, io, rooms, activegame, supabase, online));
    }
    rooms.get(roomCode).handleJoin(socket, data);
  });

  socket.on('ready',      ()     => findRoom(socket)?.handleReady(socket));
  socket.on('event',      (data) => findRoom(socket)?.handleEvent(socket, data));
  socket.on('chat',       (data) => findRoom(socket)?.handleChat(socket, typeof data === 'string' ? data : data?.text ?? ''));
  socket.on('closeLobby', ()     => findRoom(socket)?.handleCloseLobby(socket));
  socket.on('ping',       ()     => socket.emit('pong'));

  //  Matchmaking 
  socket.on('enqueue', async (data) => {
    const userId = data?.userId || data?.user_id;
    if (userId) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      if (!authUser?.user?.email_confirmed_at) {
        return socket.emit('error', { reason: 'Please verify your email address before playing multiplayer.' });
      }
    }
    mq.join(socket, data);
  });
  socket.on('dequeue',  ()     => mq.leave(socket));

  //  Presence (optional  client can call after auth) 
  socket.on('identify', ({ userId } = {}) => {
    if (userId) online.set(userId, socket.id);
  });

  //  Disconnect 
  socket.on('disconnect', () => {
    for (const [uid, sid] of online.entries()) {
      if (sid === socket.id) { online.delete(uid); break; }
    }
    findRoom(socket)?.handleDisconnect(socket);
    mq.leave(socket);
  });

  function findRoom(s) {
    for (const room of rooms.values()) {
      if (room.hasSocket(s)) return room;
    }
    return null;
  }
});

const PORT = process.env.PORT || 3001;
httpSv.listen(PORT, () => {
  console.log(`Tetris backend running on :${PORT}`);
  // Ensure avatar storage bucket exists (runs once, safe to re-run)
  initAvatarBucket().catch(() => {});
});
