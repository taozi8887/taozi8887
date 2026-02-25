// ─── Profile ──────────────────────────────────────────────────────
// GET  /api/profile/:username          public profile
// PUT  /api/profile                    update own profile
// POST /api/profile/avatar             upload avatar (multipart/form-data)
// GET  /api/profile/avatar/:key        serve avatar from R2

import { getSession } from './auth.js';
import { getRank }    from './elo.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 512 * 1024; // 512 KB

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetProfile(request, env, username) {
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.elo, u.xp, u.created_at,
            p.bio, p.avatar_key, p.country, p.display_name,
            s.games_played, s.games_won, s.games_lost,
            s.versus_played, s.versus_won,
            s.sprint_played, s.sprint_won, s.sprint_total_lines,
            s.coop_played, s.coop_won, s.coop_total_lines,
            s.total_lines, s.total_pieces, s.total_score,
            s.tetrises, s.t_spins, s.b2b_max,
            s.best_score, s.best_lines, s.best_sprint_ms,
            s.max_level, s.max_combo, s.time_played_ms,
            s.solo_played, s.solo_lines, s.solo_best_score, s.solo_time_played_ms,
            s.marathon_played, s.marathon_best_score, s.marathon_best_lines,
            s.marathon_max_level, s.marathon_total_lines, s.marathon_time_played_ms,
            s.marathon_tetrises, s.marathon_t_spins, s.marathon_b2b_max, s.marathon_max_combo,
            s.casual_vs_played, s.casual_vs_won,
            s.versus_best_score, s.versus_tetrises, s.versus_t_spins, s.versus_b2b_max, s.versus_max_combo, s.versus_time_played_ms,
            s.sprint_best_score, s.sprint_tetrises, s.sprint_t_spins, s.sprint_b2b_max, s.sprint_max_combo, s.sprint_time_played_ms,
            s.coop_best_score, s.coop_tetrises, s.coop_t_spins, s.coop_b2b_max, s.coop_max_combo, s.coop_time_played_ms,
            s.casual_vs_best_score, s.casual_vs_lines, s.casual_vs_tetrises, s.casual_vs_t_spins, s.casual_vs_b2b_max, s.casual_vs_max_combo, s.casual_vs_time_played_ms
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN stats s    ON s.user_id = u.id
     WHERE u.username = ?1`
  ).bind(username).first();

  if (!row) return jsonResponse({ error: 'User not found.' }, 404);

  const rank      = getRank(row.elo);
  const avatarUrl = row.avatar_key ? `/api/profile/avatar/${row.avatar_key}` : null;

  // Last 20 match results
  const matches = await env.DB.prepare(
    `SELECT m.id, m.mode, m.played_at, m.winner_id,
            m.p1_id, m.p2_id, m.p1_score, m.p2_score,
            m.p1_lines, m.p2_lines,
            m.p1_elo_delta, m.p2_elo_delta,
            m.is_ranked, m.duration_ms,
            m.p1_elo_before, m.p2_elo_before,
            m.p1_final_board, m.p2_final_board,
            u1.username AS p1_name, u2.username AS p2_name,
            pr1.display_name AS p1_display, pr2.display_name AS p2_display,
            u1.elo AS p1_elo, u2.elo AS p2_elo,
            u1.xp  AS p1_xp,  u2.xp  AS p2_xp
     FROM matches m
     LEFT JOIN users    u1  ON u1.id  = m.p1_id
     LEFT JOIN users    u2  ON u2.id  = m.p2_id
     LEFT JOIN profiles pr1 ON pr1.user_id = m.p1_id
     LEFT JOIN profiles pr2 ON pr2.user_id = m.p2_id
     WHERE m.p1_id = ?1 OR m.p2_id = ?1
     ORDER BY m.played_at DESC LIMIT 20`
  ).bind(row.id).all();

  return jsonResponse({
    id: row.id, username: row.username, elo: row.elo, xp: row.xp || 0, rank,
    avatarUrl, bio: row.bio, country: row.country, display_name: row.display_name,
    created_at: row.created_at,
    stats: {
      games_played: row.games_played,  games_won: row.games_won,  games_lost: row.games_lost,
      versus_played: row.versus_played, versus_won: row.versus_won,
      sprint_played: row.sprint_played, sprint_won: row.sprint_won, sprint_total_lines: row.sprint_total_lines || 0,
      coop_played:   row.coop_played,   coop_won:   row.coop_won,   coop_total_lines:   row.coop_total_lines   || 0,
      total_lines:   row.total_lines,   total_pieces: row.total_pieces,
      total_score:   row.total_score,   tetrises: row.tetrises,
      t_spins:       row.t_spins,       b2b_max: row.b2b_max,
      best_score:    row.best_score,    best_lines: row.best_lines,
      best_sprint_ms: row.best_sprint_ms, max_level: row.max_level,
      max_combo:     row.max_combo,     time_played_ms: row.time_played_ms,
      solo_played:   row.solo_played   || 0,
      solo_lines:    row.solo_lines    || 0,
      solo_best_score: row.solo_best_score || 0,
      solo_time_played_ms: row.solo_time_played_ms || 0,
      marathon_played:         row.marathon_played         || 0,
      marathon_best_score:     row.marathon_best_score     || 0,
      marathon_best_lines:     row.marathon_best_lines     || 0,
      marathon_max_level:      row.marathon_max_level      || 0,
      marathon_total_lines:    row.marathon_total_lines    || 0,
      marathon_time_played_ms: row.marathon_time_played_ms || 0,
      marathon_tetrises:       row.marathon_tetrises       || 0,
      marathon_t_spins:        row.marathon_t_spins        || 0,
      marathon_b2b_max:        row.marathon_b2b_max        || 0,
      marathon_max_combo:      row.marathon_max_combo      || 0,
      casual_vs_played:  row.casual_vs_played  || 0,
      casual_vs_won:     row.casual_vs_won     || 0,
      // Per-mode detailed stats
      versus_best_score:     row.versus_best_score     || 0,
      versus_tetrises:       row.versus_tetrises       || 0,
      versus_t_spins:        row.versus_t_spins        || 0,
      versus_b2b_max:        row.versus_b2b_max        || 0,
      versus_max_combo:      row.versus_max_combo      || 0,
      versus_time_played_ms: row.versus_time_played_ms || 0,
      sprint_best_score:     row.sprint_best_score     || 0,
      sprint_tetrises:       row.sprint_tetrises       || 0,
      sprint_t_spins:        row.sprint_t_spins        || 0,
      sprint_b2b_max:        row.sprint_b2b_max        || 0,
      sprint_max_combo:      row.sprint_max_combo      || 0,
      sprint_time_played_ms: row.sprint_time_played_ms || 0,
      coop_best_score:       row.coop_best_score       || 0,
      coop_tetrises:         row.coop_tetrises         || 0,
      coop_t_spins:          row.coop_t_spins          || 0,
      coop_b2b_max:          row.coop_b2b_max          || 0,
      coop_max_combo:        row.coop_max_combo        || 0,
      coop_time_played_ms:   row.coop_time_played_ms   || 0,
      casual_vs_best_score:     row.casual_vs_best_score     || 0,
      casual_vs_lines:          row.casual_vs_lines          || 0,
      casual_vs_tetrises:       row.casual_vs_tetrises       || 0,
      casual_vs_t_spins:        row.casual_vs_t_spins        || 0,
      casual_vs_b2b_max:        row.casual_vs_b2b_max        || 0,
      casual_vs_max_combo:      row.casual_vs_max_combo      || 0,
      casual_vs_time_played_ms: row.casual_vs_time_played_ms || 0,
    },
    recent_matches: matches.results,
  });
}

export async function handleUpdateProfile(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }

  const { bio, country, display_name } = body || {};

  const updates = [];
  const params  = [];
  let idx = 1;

  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > 200)
      return jsonResponse({ error: 'Bio must be ≤ 200 chars.' }, 400);
    updates.push(`bio = ?${idx++}`); params.push(bio.trim());
  }
  if (country !== undefined) {
    if (typeof country !== 'string' || (country !== '' && !/^[A-Z]{2}$/.test(country)))
      return jsonResponse({ error: 'Country must be a valid ISO 3166-1 alpha-2 code.' }, 400);
    updates.push(`country = ?${idx++}`); params.push(country);
  }
  if (display_name !== undefined) {
    if (typeof display_name !== 'string' || display_name.length > 30)
      return jsonResponse({ error: 'Display name must be ≤ 30 chars.' }, 400);
    updates.push(`display_name = ?${idx++}`); params.push(display_name.trim());
  }

  if (updates.length === 0) return jsonResponse({ error: 'Nothing to update.' }, 400);

  params.push(session.userId);
  await env.DB.prepare(
    `UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?${idx}`
  ).bind(...params).run();

  return jsonResponse({ ok: true });
}

export async function handleAvatarUpload(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('avatar');
  if (!file || typeof file.size === 'undefined')
    return jsonResponse({ error: 'No file provided.' }, 400);

  if (!ALLOWED_MIME.has(file.type))
    return jsonResponse({ error: 'Allowed formats: JPEG, PNG, WebP, GIF.' }, 400);

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_AVATAR_BYTES)
    return jsonResponse({ error: `Avatar must be ≤ 512 KB.` }, 400);

  // Delete old avatar
  const cur = await env.DB.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?1')
    .bind(session.userId).first();
  if (cur?.avatar_key) {
    await env.AVATARS.delete(cur.avatar_key).catch(() => {});
  }

  // Store with a random key so old URLs are invalidated
  const key = `${session.userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
  await env.AVATARS.put(key, bytes, { httpMetadata: { contentType: file.type } });

  await env.DB.prepare('UPDATE profiles SET avatar_key = ?1 WHERE user_id = ?2')
    .bind(key, session.userId).run();

  return jsonResponse({ ok: true, avatarUrl: `/api/profile/avatar/${key}` });
}

export async function handleAvatarServe(request, env, key) {
  // Key comes from URL, ensure it doesn't traverse directories
  const safeKey = key.replace(/\.\./g, '').replace(/^\/+/, '');
  const obj = await env.AVATARS.get(safeKey);
  if (!obj) return new Response('Not found.', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      // Keys are UUID-based and change on every upload → safe to cache long-term
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// GET /api/profile/settings  - fetch own settings JSON
export async function handleGetSettings(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const row = await env.DB.prepare('SELECT settings FROM profiles WHERE user_id = ?1')
    .bind(session.userId).first();

  let settings = {};
  try { if (row?.settings) settings = JSON.parse(row.settings); } catch {}
  return jsonResponse({ settings });
}

// PUT /api/profile/settings  - save own settings JSON (full replace)
export async function handleUpdateSettings(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }

  const { settings } = body || {};
  if (!settings || typeof settings !== 'object')
    return jsonResponse({ error: 'settings object required.' }, 400);

  const json = JSON.stringify(settings);
  if (json.length > 8000) return jsonResponse({ error: 'Settings payload too large.' }, 400);

  await env.DB.prepare('UPDATE profiles SET settings = ?1 WHERE user_id = ?2')
    .bind(json, session.userId).run();

  return jsonResponse({ ok: true });
}
