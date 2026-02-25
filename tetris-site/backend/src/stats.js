// ─── Stats ────────────────────────────────────────────────────────
// Called internally by the game server after each match ends.
// POST /api/stats/record  (internal - requires INTERNAL_KEY header)

import { calcElo } from './elo.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uuid() { return crypto.randomUUID(); }

// ── XP / Level helpers ────────────────────────────────────────────
// XP required to advance from level N to N+1: 500 + (N-1)*100
// Total XP to reach level N = (N-1)*(400 + 50*N)
function getLevel(xp) {
  const v = Math.max(0, xp || 0);
  return Math.max(1, Math.floor((-350 + Math.sqrt(202500 + 200 * v)) / 100));
}

function calcXpGain({ lines = 0, tetrises = 0, tSpins = 0, durationMs = 0, isWinner = false, mode = 'versus' }) {
  let xp = 20;                                   // base per completed game
  xp += lines * 5;                               // 5 XP per line
  xp += tetrises * 10;                           // 10 XP per tetris
  xp += tSpins * 8;                              // 8 XP per t-spin
  xp += Math.floor(durationMs / 5000);           // 1 XP per 5 s
  if (mode === 'versus')      { xp += isWinner ? 75 : 10; }
  else if (mode === 'sprint') { xp += isWinner ? 50 : 10; }
  else if (mode === 'coop')   { xp += isWinner ? 50 : 20; }
  else                        { xp += 25; }      // solo / marathon
  return Math.round(xp);
}

/**
 * Record a completed match, update ELO, and bump stats for both players.
 * Called by the Durable Object (GameRoom) after match ends.
 *
 * Expected body:
 * {
 *   mode,           'versus' | 'sprint' | 'coop'
 *   roomCode,
 *   p1Id, p2Id,     null = guest
 *   winnerId,       null for coop loss / no winner
 *   p1Score, p2Score,
 *   p1Lines, p2Lines,
 *   p1Stats: { tetrises, tSpins, b2bMax, maxCombo, bestSprint, maxLevel, pieces, timeMs },
 *   p2Stats: { ... },
 *   durationMs,
 * }
 */
export async function handleRecordMatch(request, env) {
  // Only allow calls from our own Durable Object (checked via header secret).
  // INTERNAL_KEY may be absent in local wrangler dev — allow through in that case.
  const headerSecret = request.headers.get('X-Internal-Key');
  if (env.INTERNAL_KEY && headerSecret !== env.INTERNAL_KEY)
    return jsonResponse({ error: 'Forbidden.' }, 403);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }

  const { mode, roomCode, isRanked = true, voidReason = null, p1Id, p2Id, winnerId, p1Score, p2Score,
          p1Lines, p2Lines, p1Stats = {}, p2Stats = {}, durationMs = 0,
          p1EloBefore = null, p2EloBefore = null,
          p1FinalBoard = null, p2FinalBoard = null } = body;

  // Disconnects never affect ELO or ranked stats (network drops shouldn't punish players)
  const effectivelyRanked = isRanked && !voidReason;

  // ── ELO update (ranked versus only, both players must be registered) ──
  let p1ELODelta = 0, p2ELODelta = 0;

  if (effectivelyRanked && mode === 'versus' && p1Id && p2Id) {
    const [p1, p2] = await Promise.all([
      env.DB.prepare('SELECT elo FROM users WHERE id = ?1').bind(p1Id).first(),
      env.DB.prepare('SELECT elo FROM users WHERE id = ?1').bind(p2Id).first(),
    ]);
    const [s1row, s2row] = await Promise.all([
      env.DB.prepare('SELECT games_played FROM stats WHERE user_id = ?1').bind(p1Id).first(),
      env.DB.prepare('SELECT games_played FROM stats WHERE user_id = ?1').bind(p2Id).first(),
    ]);

    if (p1 && p2) {
      const scoreA = winnerId === p1Id ? 1 : winnerId === p2Id ? 0 : 0.5;
      const elo = calcElo(p1.elo, p2.elo, scoreA, s1row?.games_played || 0, s2row?.games_played || 0);
      p1ELODelta = elo.deltaA;
      p2ELODelta = elo.deltaB;

      await env.DB.batch([
        env.DB.prepare('UPDATE users SET elo = elo + ?1, updated_at = ?2 WHERE id = ?3')
          .bind(p1ELODelta, Date.now(), p1Id),
        env.DB.prepare('UPDATE users SET elo = elo + ?1, updated_at = ?2 WHERE id = ?3')
          .bind(p2ELODelta, Date.now(), p2Id),
      ]);
    }
  }

  const now      = Date.now();
  const matchId  = uuid();

  // ── Insert match record ────────────────────────────────────────
  await env.DB.prepare(
    `INSERT INTO matches (id,mode,room_code,p1_id,p2_id,winner_id,
      p1_score,p2_score,p1_lines,p2_lines,p1_elo_delta,p2_elo_delta,is_ranked,void_reason,duration_ms,played_at,
      p1_elo_before,p2_elo_before,p1_final_board,p2_final_board)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`
  ).bind(matchId, mode, roomCode, p1Id || null, p2Id || null, winnerId || null,
         p1Score || 0, p2Score || 0, p1Lines || 0, p2Lines || 0,
         p1ELODelta, p2ELODelta, isRanked ? 1 : 0, voidReason || null, durationMs, now,
         p1EloBefore, p2EloBefore, p1FinalBoard, p2FinalBoard).run();

  // ── Update per-player stats ────────────────────────────────────
  const modifyStats = async (userId, myScore, myLines, myStats, isWinner) => {
    if (!userId) return;
    const won  = isWinner ? 1 : 0;

    // Casual versus OR voided ranked game: only track casual_vs columns, no ranked columns.
    if (!effectivelyRanked && mode === 'versus') {
      await env.DB.prepare(
        `UPDATE stats SET
          games_played             = games_played  + 1,
          games_won                = games_won     + ?1,
          games_lost               = games_lost    + ?2,
          casual_vs_played         = casual_vs_played + 1,
          casual_vs_won            = casual_vs_won    + ?1,
          casual_vs_lines          = casual_vs_lines  + ?3,
          casual_vs_best_score     = MAX(casual_vs_best_score, ?5),
          casual_vs_tetrises       = casual_vs_tetrises   + ?6,
          casual_vs_t_spins        = casual_vs_t_spins    + ?7,
          casual_vs_b2b_max        = MAX(casual_vs_b2b_max, ?8),
          casual_vs_max_combo      = MAX(casual_vs_max_combo, ?10),
          casual_vs_time_played_ms = casual_vs_time_played_ms + ?12,
          total_lines              = total_lines   + ?3,
          total_pieces             = total_pieces  + ?4,
          total_score              = total_score   + ?5,
          tetrises                 = tetrises      + ?6,
          t_spins                  = t_spins       + ?7,
          b2b_max                  = MAX(b2b_max,  ?8),
          max_combo                = MAX(max_combo, ?10),
          time_played_ms           = time_played_ms + ?12
        WHERE user_id = ?13`
      ).bind(
        won, 1 - won,
        myLines || 0,
        myStats.pieces || 0,
        myScore || 0,
        myStats.tetrises || 0,
        myStats.tSpins || 0,
        myStats.b2bMax || 0,
        myStats.maxLevel || 0,
        myStats.maxCombo || 0,
        myStats.bestSprint || 0,
        Math.round(durationMs || 0),
        userId
      ).run();
      return;
    }

    // Ranked game - original behaviour.
    const mCol = mode === 'versus' ? 'versus' : mode === 'sprint' ? 'sprint' : 'coop';
    await env.DB.prepare(
      `UPDATE stats SET
        games_played  = games_played + 1,
        games_won     = games_won    + ?1,
        games_lost    = games_lost   + ?2,
        ${mCol}_played = ${mCol}_played + 1,
        ${mCol}_won    = ${mCol}_won   + ?1,
        ${mCol}_best_score     = MAX(${mCol}_best_score,  ?5),
        ${mCol}_tetrises       = ${mCol}_tetrises   + ?6,
        ${mCol}_t_spins        = ${mCol}_t_spins    + ?7,
        ${mCol}_b2b_max        = MAX(${mCol}_b2b_max,    ?8),
        ${mCol}_max_combo      = MAX(${mCol}_max_combo,  ?10),
        ${mCol}_time_played_ms = ${mCol}_time_played_ms + ?12,
        ${mCol !== 'versus' ? `${mCol}_total_lines = ${mCol}_total_lines + ?3,` : ''}
        total_lines    = total_lines   + ?3,
        total_pieces   = total_pieces  + ?4,
        total_score    = total_score   + ?5,
        tetrises       = tetrises      + ?6,
        t_spins        = t_spins       + ?7,
        b2b_max        = MAX(b2b_max,  ?8),
        best_score     = MAX(best_score,?5),
        best_lines     = MAX(best_lines,?3),
        max_level      = MAX(max_level, ?9),
        max_combo      = MAX(max_combo, ?10),
        best_sprint_ms = CASE WHEN ?11 > 0 AND (best_sprint_ms = 0 OR ?11 < best_sprint_ms) THEN ?11 ELSE best_sprint_ms END,
        time_played_ms = time_played_ms + ?12
      WHERE user_id = ?13`
    ).bind(
      won, 1 - won,
      myLines || 0,
      myStats.pieces || 0,
      myScore || 0,
      myStats.tetrises || 0,
      myStats.tSpins || 0,
      myStats.b2bMax || 0,
      myStats.maxLevel || 0,
      myStats.maxCombo || 0,
      myStats.bestSprint || 0,
      Math.round(durationMs || 0),
      userId
    ).run();
  };

  await Promise.all([
    modifyStats(p1Id, p1Score, p1Lines, p1Stats, winnerId === p1Id),
    modifyStats(p2Id, p2Score, p2Lines, p2Stats, winnerId === p2Id),
  ]);

  // ── Award XP to each authenticated player ─────────────────────
  const awardXp = async (userId, myLines, myStats, isWinner) => {
    if (!userId) return null;
    const xpRow = await env.DB.prepare('SELECT xp FROM users WHERE id = ?1').bind(userId).first();
    const prevXp    = xpRow?.xp || 0;
    const prevLevel = getLevel(prevXp);
    const xpGained  = calcXpGain({
      lines: myLines || 0,
      tetrises: myStats?.tetrises || 0,
      tSpins: myStats?.tSpins || 0,
      durationMs: durationMs || 0,
      isWinner,
      mode,
    });
    const newXp = prevXp + xpGained;
    const newLevel = getLevel(newXp);
    await env.DB.prepare('UPDATE users SET xp = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(newXp, Date.now(), userId).run();
    return { xpGained, prevXp, xp: newXp, prevLevel, level: newLevel, leveledUp: newLevel > prevLevel };
  };

  const [p1XP, p2XP] = await Promise.all([
    awardXp(p1Id, p1Lines, p1Stats, winnerId === p1Id),
    awardXp(p2Id, p2Lines, p2Stats, winnerId === p2Id),
  ]);

  return jsonResponse({ ok: true, matchId, p1ELODelta, p2ELODelta,
    p1XP: p1XP || null, p2XP: p2XP || null });
}

// GET /api/leaderboard?page=1&limit=25&q=username&rank=Gold
export async function handleLeaderboard(request, env) {
  const url    = new URL(request.url);
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25')));
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
  const q      = (url.searchParams.get('q')    || '').trim();
  const rank   = (url.searchParams.get('rank') || '').trim();
  const offset = (page - 1) * limit;

  // Build WHERE clause (params go into filterBinds; same for both SELECT and COUNT)
  const conditions = [];
  const filterBinds = [];
  if (q) {
    conditions.push('u.username LIKE ?');
    filterBinds.push('%' + q.replace(/%/g, '') + '%');
  }

  // Rank filter - convert rank name to ELO range
  const RANK_ELO = {
    Challenger:  [2600, 9999],
    Grandmaster: [2200, 2599],
    Master:      [2000, 2199],
    Diamond:     [1800, 1999],
    Platinum:    [1600, 1799],
    Gold:        [1400, 1599],
    Silver:      [1200, 1399],
    Bronze:      [1000, 1199],
    Iron:        [ 800,  999],
    Unranked:    [   0,  799],
  };
  if (rank && RANK_ELO[rank]) {
    const [lo, hi] = RANK_ELO[rank];
    conditions.push('u.elo BETWEEN ? AND ?');
    filterBinds.push(lo, hi);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Main query - filter binds first, then LIMIT/OFFSET at the end
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.elo, u.xp, p.avatar_key, p.country, p.display_name,
            s.games_played, s.games_won, s.versus_played, s.versus_won,
            s.total_lines, s.best_score, s.best_sprint_ms
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN stats s    ON s.user_id = u.id
     ${where}
     ORDER BY u.elo DESC LIMIT ? OFFSET ?`
  ).bind(...filterBinds, limit, offset).all();

  // Count query - only filter binds, no LIMIT/OFFSET
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u ${where}`
  ).bind(...filterBinds).first().catch(() => ({ n: 0 }));

  return new Response(JSON.stringify({
    players: rows.results.map((r, i) => ({
      rank:          offset + i + 1,
      id:            r.id,
      username:      r.username,
      elo:           r.elo,
      xp:            r.xp || 0,
      country:       r.country        || '',
      display_name:  r.display_name   || '',
      avatarUrl:     r.avatar_key ? `/api/profile/avatar/${r.avatar_key}` : null,
      games_played:  r.games_played   || 0,
      games_won:     r.games_won      || 0,
      versus_played: r.versus_played  || 0,
      versus_won:    r.versus_won     || 0,
      total_lines:   r.total_lines    || 0,
      best_score:    r.best_score     || 0,
      best_sprint_ms:r.best_sprint_ms || 0,
    })),
    total:   countRow?.n   || 0,
    page,
    hasMore: (offset + limit) < (countRow?.n || 0),
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/stats/solo  (auth-required, called from frontend after a solo game)
// Body: { mode: 'marathon', score, lines, level, timeMs }
export async function handleRecordSolo(request, env) {
  const { getSession } = await import('./auth.js');
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }

  const { mode = 'marathon', score = 0, lines = 0, level = 1, timeMs = 0,
          tetrises = 0, tSpins = 0, b2bMax = 0, maxCombo = 0 } = body || {};

  if (mode === 'marathon') {
    await env.DB.prepare(
      `UPDATE stats SET
         marathon_played         = marathon_played + 1,
         marathon_best_score     = MAX(marathon_best_score, ?1),
         marathon_best_lines     = MAX(marathon_best_lines, ?2),
         marathon_max_level      = MAX(marathon_max_level, ?3),
         marathon_total_lines    = marathon_total_lines + ?2,
         marathon_time_played_ms = marathon_time_played_ms + ?4,
         marathon_tetrises       = marathon_tetrises + ?5,
         marathon_t_spins        = marathon_t_spins  + ?6,
         marathon_b2b_max        = MAX(marathon_b2b_max, ?7),
         marathon_max_combo      = MAX(marathon_max_combo, ?8)
       WHERE user_id = ?9`
    ).bind(
      Math.max(0, Math.round(score)),
      Math.max(0, Math.round(lines)),
      Math.max(1, Math.round(level)),
      Math.max(0, Math.round(timeMs)),
      Math.max(0, Math.round(tetrises)),
      Math.max(0, Math.round(tSpins)),
      Math.max(0, Math.round(b2bMax)),
      Math.max(0, Math.round(maxCombo)),
      session.userId
    ).run();
  }
  // future modes (sprint solo, blitz, etc.) can be added here

  // ── Award XP ──────────────────────────────────────────────────
  const xpRow = await env.DB.prepare('SELECT xp FROM users WHERE id = ?1').bind(session.userId).first();
  const prevXp    = xpRow?.xp || 0;
  const prevLevel = getLevel(prevXp);
  const xpGained  = calcXpGain({
    lines: Math.max(0, Math.round(lines)),
    tetrises: Math.max(0, Math.round(tetrises)),
    tSpins: Math.max(0, Math.round(tSpins)),
    durationMs: Math.max(0, Math.round(timeMs)),
    isWinner: false,
    mode,
  });
  const newXp    = prevXp + xpGained;
  const newLevel = getLevel(newXp);
  await env.DB.prepare('UPDATE users SET xp = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(newXp, Date.now(), session.userId).run();

  return jsonResponse({
    ok: true,
    xpGained, prevXp, xp: newXp,
    prevLevel, level: newLevel,
    leveledUp: newLevel > prevLevel,
  });
}

// GET /api/stats/global  - aggregate totals used by the homepage banner
export async function handleGlobalStats(request, env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total_players,
            SUM(versus_played + sprint_played + coop_played + marathon_played) AS total_games,
            SUM(COALESCE(time_played_ms,0) + COALESCE(marathon_time_played_ms,0)) AS total_time_ms,
            SUM(total_lines + marathon_total_lines) AS total_lines
     FROM users u
     LEFT JOIN stats s ON s.user_id = u.id`
  ).first();

  return jsonResponse({
    total_players: row?.total_players || 0,
    total_games:   row?.total_games   || 0,
    total_time_ms: row?.total_time_ms || 0,
    total_lines:   row?.total_lines   || 0,
  });
}
