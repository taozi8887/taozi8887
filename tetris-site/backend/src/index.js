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
import { router as cosmeticsRouter } from './cosmetics.js';
import { router as notificationsRouter } from './notifications.js';

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

// Separate client used ONLY for auth operations (signUp, signInWithPassword,
// getUser, etc.) so those calls never pollute the main client's in-memory
// session state, which would cause subsequent DB queries to run as the user
// (with RLS) instead of as the service role.
export const authClient = createClient(
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
app.use('/api/auth',      authRouter);
app.use('/api/profile',   profileRouter);
app.use('/api/stats',     statsRouter);
app.use('/api/friends',   friendsRouter);
app.use('/api/cosmetics', cosmeticsRouter);
app.use('/api/notifications', notificationsRouter);

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
      .select('id, username, display_name, elo, xp, profiles(avatar_url, country, equipped_border, equipped_title), stats(versus_played, versus_won)', { count: 'exact' })
      .order('elo', { ascending: false });

    if (q)    query = query.ilike('username', `%${q}%`);
    if (rank && RANK_RANGES[rank]) {
      query = query.gte('elo', RANK_RANGES[rank][0]).lte('elo', RANK_RANGES[rank][1]);
    }
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const entries = (data || []).map((u, i) => ({
      rank:            offset + i + 1,
      id:              u.id,
      username:        u.username,
      display_name:    u.display_name || '',
      elo:             u.elo ?? 1000,
      xp:              u.xp  ?? 0,
      avatar_url:      u.profiles?.avatar_url      || null,
      country:         u.profiles?.country          || '',
      equipped_border: u.profiles?.equipped_border  || null,
      equipped_title:  u.profiles?.equipped_title   || null,
      versus_played:   u.stats?.versus_played || 0,
      versus_won:      u.stats?.versus_won    || 0,
    }));

    // Enrich with cosmetic metadata (name, rarity, icon) in one batch query
    const cosSlugSet = new Set();
    entries.forEach(e => {
      if (e.equipped_border) cosSlugSet.add(e.equipped_border);
      if (e.equipped_title)  cosSlugSet.add(e.equipped_title);
    });
    const cosMap = {};
    if (cosSlugSet.size) {
      let { data: cosRows } = await supabase.from('cosmetics').select('slug,name,rarity,icon').in('slug',[...cosSlugSet]);
      if (!cosRows?.length) {
        await new Promise(r => setTimeout(r, 400));
        ({ data: cosRows } = await supabase.from('cosmetics').select('slug,name,rarity,icon').in('slug',[...cosSlugSet]));
      }
      for (const c of cosRows||[]) cosMap[c.slug] = c;
    }
    const enriched = entries.map(e => ({
      ...e,
      equipped_title_info:  e.equipped_title  ? (cosMap[e.equipped_title]  || null) : null,
      equipped_border_info: e.equipped_border ? (cosMap[e.equipped_border] || null) : null,
    }));

    res.json({ entries: enriched, total: count || 0, page, limit });
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

// Warm up Supabase BEFORE accepting connections so the first real request
// never hits a cold pool and gets empty results.
async function start() {
  try {
    await supabase.from('cosmetics').select('slug').limit(1);
    console.log('[db] connection pool warmed up');
  } catch {
    console.warn('[db] warm-up query failed — server will still start');
  }
  httpSv.listen(PORT, () => {
    console.log(`Tetris backend running on :${PORT}`);
    // Ensure avatar storage bucket exists (runs once, safe to re-run)
    initAvatarBucket().catch(() => {});
  });
}
start();
