// ─── Friends & Challenge Inbox ────────────────────────────────────
// GET  /api/friends               list accepted friends
// POST /api/friends/request       send friend request (body: { username })
// POST /api/friends/respond       accept/decline request (body: { id, action })
// DELETE /api/friends/:userId     remove friend
//
// GET  /api/inbox                 pending challenge invites
// POST /api/inbox/challenge       send a challenge (body: { username, mode, message })
// POST /api/inbox/respond         accept/decline challenge (body: { id, action })

import { getSession } from './auth.js';

function uuid() { return crypto.randomUUID(); }

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Friends ──────────────────────────────────────────────────────

export async function handleListFriends(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const rows = await env.DB.prepare(
    `SELECT f.id, f.status, f.created_at, f.requester_id,
            CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END AS friend_id,
            u.username, u.elo, u.xp, p.avatar_key, p.display_name
     FROM friendships f
     JOIN users u    ON u.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE (f.requester_id = ?1 OR f.addressee_id = ?1)
       AND f.status IN ('accepted', 'pending')
     ORDER BY f.updated_at DESC`
  ).bind(session.userId).all();

  // Batch-check online presence and active game for each accepted friend
  const now = Date.now();
  const [presValues, gameValues] = await Promise.all([
    Promise.all(rows.results.map(r => env.RATE_KV.get('pres:' + r.friend_id).catch(() => null))),
    Promise.all(rows.results.map(r => env.RATE_KV.get('activegame:' + r.friend_id).catch(() => null))),
  ]);

  const friends = rows.results.map((r, i) => {
    const presTs = presValues[i] ? parseInt(presValues[i], 10) : 0;
    const online = presTs > 0 && (now - presTs) < 130_000; // 120s TTL + 10s grace
    const roomCode = gameValues[i] || null;
    return {
      id: r.id, status: r.status, created_at: r.created_at,
      friend: {
        id: r.friend_id, username: r.username, elo: r.elo, xp: r.xp || 0,
        display_name: r.display_name,
        avatarUrl: r.avatar_key ? `/api/profile/avatar/${r.avatar_key}` : null,
        online,
        inGame: !!roomCode,
        roomCode,
      },
      isPending:  r.status === 'pending',
      isSent:     r.status === 'pending' && r.requester_id === session.userId,
    };
  });

  return jsonResponse({ friends });
}

export async function handleFriendRequest(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }
  const { username } = body || {};
  if (!username) return jsonResponse({ error: 'username required.' }, 400);
  if (username.toLowerCase() === session.username?.toLowerCase())
    return jsonResponse({ error: "You can't add yourself." }, 400);

  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(username).first();
  if (!target) return jsonResponse({ error: 'User not found.' }, 404);

  const existing = await env.DB.prepare(
    `SELECT id, status FROM friendships WHERE (requester_id = ?1 AND addressee_id = ?2)
       OR (requester_id = ?2 AND addressee_id = ?1)`
  ).bind(session.userId, target.id).first();

  if (existing) {
    if (existing.status === 'accepted') return jsonResponse({ error: 'Already friends.' }, 409);
    if (existing.status === 'pending')  return jsonResponse({ error: 'Request already pending.' }, 409);
  }

  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO friendships (id,requester_id,addressee_id,status,created_at,updated_at) VALUES (?1,?2,?3,"pending",?4,?4)'
  ).bind(uuid(), session.userId, target.id, now).run();

  return jsonResponse({ ok: true });
}

export async function handleRespondFriendRequest(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }
  const { id, action } = body || {};
  if (!id || !['accept', 'decline'].includes(action))
    return jsonResponse({ error: 'id and action (accept|decline) required.' }, 400);

  const row = await env.DB.prepare(
    'SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?1'
  ).bind(id).first();

  if (!row || row.status !== 'pending')
    return jsonResponse({ error: 'Request not found.' }, 404);

  const isAddressee = row.addressee_id === session.userId;
  const isRequester = row.requester_id === session.userId;

  if (!isAddressee && !isRequester)
    return jsonResponse({ error: 'Request not found.' }, 404);

  // Only the addressee can accept; requester can only cancel (decline)
  if (action === 'accept' && !isAddressee)
    return jsonResponse({ error: 'Only the recipient can accept a friend request.' }, 403);

  if (action === 'accept') {
    await env.DB.prepare('UPDATE friendships SET status="accepted", updated_at=?1 WHERE id=?2')
      .bind(Date.now(), id).run();
  } else {
    await env.DB.prepare('DELETE FROM friendships WHERE id = ?1').bind(id).run();
  }

  return jsonResponse({ ok: true });
}

export async function handleRemoveFriend(request, env, friendId) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  await env.DB.prepare(
    `DELETE FROM friendships WHERE status = 'accepted'
     AND ((requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1))`
  ).bind(session.userId, friendId).run();

  return jsonResponse({ ok: true });
}

// ── Challenge Inbox ──────────────────────────────────────────────

export async function handleInbox(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const now = Date.now();
  // Expire old challenges
  await env.DB.prepare("UPDATE challenges SET status='expired' WHERE expires_at < ?1 AND status='pending'")
    .bind(now).run();

  const rows = await env.DB.prepare(
    `SELECT c.id, c.mode, c.room_code, c.message, c.created_at, c.expires_at, c.status,
            u.username AS from_username, u.elo AS from_elo,
            p.avatar_key AS from_avatar, p.display_name AS from_display
     FROM challenges c
     JOIN users u    ON u.id = c.from_user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE c.to_user_id = ?1 AND c.status = 'pending'
     ORDER BY c.created_at DESC LIMIT 30`
  ).bind(session.userId).all();

  return jsonResponse({
    challenges: rows.results.map(r => ({
      ...r,
      from: {
        username:     r.from_username,
        display_name: r.from_display,
        elo:          r.from_elo,
        avatarUrl:    r.from_avatar ? `/api/profile/avatar/${r.from_avatar}` : null,
      },
      from_username: undefined, from_avatar: undefined, from_display: undefined, from_elo: undefined,
    })),
  });
}

export async function handleSendChallenge(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }
  const { username, mode = 'versus', message = '' } = body || {};

  if (!username) return jsonResponse({ error: 'username required.' }, 400);
  if (!['versus','sprint','coop'].includes(mode)) return jsonResponse({ error: 'Invalid mode.' }, 400);

  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(username).first();
  if (!target) return jsonResponse({ error: 'User not found.' }, 404);
  if (target.id === session.userId) return jsonResponse({ error: "Can't challenge yourself." }, 400);

  // Generate room code and register in KV with 5-minute TTL (matches lobby countdown)
  const CHALLENGE_TTL_MS  = 5 * 60 * 1000;  // 5 minutes
  const CHALLENGE_TTL_SEC = 5 * 60;
  const room_code = Math.random().toString(36).slice(2, 8).toUpperCase();
  if (env.RATE_KV) {
    await env.RATE_KV.put(`room:${room_code}`, '1', { expirationTtl: CHALLENGE_TTL_SEC });
  }

  const now       = Date.now();
  const expiresAt = now + CHALLENGE_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO challenges (id,from_user_id,to_user_id,mode,room_code,message,status,created_at,expires_at)
     VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8)`
  ).bind(uuid(), session.userId, target.id, mode, room_code,
         (message || '').slice(0, 120), now, expiresAt).run();

  return jsonResponse({ ok: true, room_code, mode });
}

export async function handleRespondChallenge(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }
  const { id, action } = body || {};
  if (!id || !['accept','decline'].includes(action))
    return jsonResponse({ error: 'id and action (accept|decline) required.' }, 400);

  const row = await env.DB.prepare(
    'SELECT id, from_user_id, room_code, mode, status FROM challenges WHERE id = ?1'
  ).bind(id).first();

  if (!row || row.status !== 'pending') return jsonResponse({ error: 'Challenge not found.' }, 404);

  const newStatus = action === 'accept' ? 'accepted' : 'declined';
  await env.DB.prepare('UPDATE challenges SET status = ?1 WHERE id = ?2')
    .bind(newStatus, id).run();

  if (action === 'accept') {
    return jsonResponse({ ok: true, room_code: row.room_code, mode: row.mode });
  }
  return jsonResponse({ ok: true });
}
