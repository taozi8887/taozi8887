// ─── Main Router ─────────────────────────────────────────────────
// Cloudflare Worker entry point

import { handleRegister, handleLogin, handleLogout, handleMe } from './auth.js';
import {
  handleGetProfile, handleUpdateProfile, handleAvatarUpload, handleAvatarServe,
  handleGetSettings, handleUpdateSettings,
} from './profile.js';
import { handleRecordMatch, handleLeaderboard, handleRecordSolo, handleGlobalStats } from './stats.js';
import {
  handleListFriends, handleFriendRequest, handleRespondFriendRequest,
  handleRemoveFriend, handleInbox, handleSendChallenge, handleRespondChallenge,
} from './friends.js';
export { GameRoom } from './gameserver.js';
export { MatchmakingQueue } from './matchmaking.js';

// ── CORS helper ──────────────────────────────────────────────────

function cors(response, env, request) {
  const reqOrigin = request?.headers?.get('Origin') || '';
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqOrigin);
  const origin = isLocal ? reqOrigin : (env.CORS_ORIGIN || 'https://tetris.taozi4887.dev');
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin',      origin);
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Access-Control-Allow-Methods',     'GET,POST,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers',     'Content-Type, Authorization, X-Internal-Key');
  // Security headers
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options',        'DENY');
  h.set('Referrer-Policy',        'strict-origin-when-cross-origin');
  h.set('Permissions-Policy',     'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers: h });
}

function notFound() {
  return new Response(JSON.stringify({ error: 'Not found.' }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
}

// ── Main fetch handler ───────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const method = request.method.toUpperCase();
    const url    = new URL(request.url);
    const path   = url.pathname;

    // OPTIONS pre-flight
    if (method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), env, request);
    }

    // WebSocket upgrade - must bypass cors() because new Response(...) drops the
    // webSocket property, turning every 101 into a 500.
    if (request.headers.get('Upgrade') === 'websocket') {
      return route(request, env, ctx, method, path);
    }

    let response;
    try {
      response = await route(request, env, ctx, method, path);
    } catch (err) {
      console.error('Unhandled error:', err);
      response = new Response(JSON.stringify({ error: 'Internal server error.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    return cors(response, env, request);
  },
};

async function route(request, env, ctx, method, path) {
  // ── Auth ────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/auth/register') return handleRegister(request, env);
  if (method === 'POST' && path === '/api/auth/login')    return handleLogin(request, env);
  if (method === 'POST' && path === '/api/auth/logout')   return handleLogout(request, env);
  if (method === 'GET'  && path === '/api/auth/me')       return handleMe(request, env);

  // ── Profile ─────────────────────────────────────────────────────
  if (method === 'GET'  && path.startsWith('/api/profile/avatar/')) {
    const key = path.slice('/api/profile/avatar/'.length);
    return handleAvatarServe(request, env, key);
  }
  if (method === 'GET'  && path === '/api/profile') {
    // get own profile
    const { getSession } = await import('./auth.js');
    const sess = await getSession(request, env);
    if (!sess) return new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return handleGetProfile(request, env, sess.username);
  }
  // Settings routes must come BEFORE the wildcard /api/profile/:username
  if (method === 'GET'  && path === '/api/profile/settings') return handleGetSettings(request, env);
  if (method === 'PUT'  && path === '/api/profile/settings') return handleUpdateSettings(request, env);
  if (method === 'GET'  && path.startsWith('/api/profile/')) {
    const username = decodeURIComponent(path.slice('/api/profile/'.length));
    return handleGetProfile(request, env, username);
  }
  if (method === 'PUT'  && path === '/api/profile')          return handleUpdateProfile(request, env);
  if (method === 'POST' && path === '/api/profile/avatar')   return handleAvatarUpload(request, env);

  // ── Stats / Leaderboard ─────────────────────────────────────────
  if (method === 'GET'  && path === '/api/leaderboard')   return handleLeaderboard(request, env);
  if (method === 'GET'  && path === '/api/stats/global')  return handleGlobalStats(request, env);
  if (method === 'POST' && path === '/api/stats/record')  return handleRecordMatch(request, env);
  if (method === 'POST' && path === '/api/stats/solo')    return handleRecordSolo(request, env);

  // ── Friends ─────────────────────────────────────────────────────
  if (method === 'GET'    && path === '/api/friends') return handleListFriends(request, env);
  if (method === 'POST'   && path === '/api/friends/request') return handleFriendRequest(request, env);
  if (method === 'POST'   && path === '/api/friends/respond') return handleRespondFriendRequest(request, env);
  if (method === 'DELETE' && path.startsWith('/api/friends/')) {
    const friendId = path.slice('/api/friends/'.length);
    return handleRemoveFriend(request, env, friendId);
  }

  // ── Inbox ────────────────────────────────────────────────────────
  if (method === 'GET'  && path === '/api/inbox')               return handleInbox(request, env);
  if (method === 'POST' && path === '/api/inbox/challenge')     return handleSendChallenge(request, env);
  if (method === 'POST' && path === '/api/inbox/respond')       return handleRespondChallenge(request, env);
  // ── Matchmaking queue (Durable Object, WebSocket only) ────────────────────
  if (path.startsWith('/matchmaking/')) {
    // Must be a WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ error: 'WebSocket upgrade required.' }), {
        status: 426, headers: { 'Content-Type': 'application/json' },
      });
    }
    const mode = path.slice('/matchmaking/'.length); // 'ranked-versus' | 'casual-versus' | 'sprint' | 'coop'
    if (!['ranked-versus', 'casual-versus', 'sprint', 'coop'].includes(mode)) {
      return new Response(JSON.stringify({ error: 'Unknown queue mode.' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const id   = env.MATCHMAKING_QUEUE.idFromName(mode);
    const stub = env.MATCHMAKING_QUEUE.get(id);
    return stub.fetch(request);
  }
  // ── Live MP rooms (Durable Object) ──────────────────────────────
  // Generate a new room code (Durable Objects are created lazily on first WS connect)
  if (method === 'GET' && path === '/create') {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    // Register the code in KV so /room/{code} can reject bogus codes (2 hr TTL)
    await env.RATE_KV.put(`room:${roomCode}`, '1', { expirationTtl: 7200 });
    return new Response(JSON.stringify({ roomCode }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (path.startsWith('/room/')) {
    const roomCode = path.slice('/room/'.length);
    // Reject connections to room codes that were never created via /create
    // (skip KV check if RATE_KV is not configured, e.g. local dev without KV)
    const exists = env.RATE_KV ? await env.RATE_KV.get(`room:${roomCode}`) : true;
    if (!exists) {
      return new Response(JSON.stringify({ error: 'Room not found.' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    // Non-WebSocket probe (pre-join existence check from the lobby UI)
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ exists: true, roomCode }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    const id = env.GAME_ROOM.idFromName(roomCode);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(request);
  }

  // ── Health check ────────────────────────────────────────────────
  if (path === '/health') {
    return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return notFound();
}
