//  Stats 
// GET  /api/stats/global    aggregate site stats
// POST /api/stats/solo      record solo/marathon game
// GET  /api/stats/me        own stats summary

import { Router } from 'express';
import { supabase } from './index.js';
import { requireAuth, requireEmailVerified } from './auth.js';

export const router = Router();

// XP formula (same as gameroom.js)
function calcXpGainSolo({ lines, tetrises, tSpins, durationMs, mode }) {
  return Math.max(1, Math.round(
    20
    + lines * 5
    + tetrises * 10
    + tSpins   * 8
    + Math.floor((durationMs || 0) / 5000)
    + (mode === 'marathon' ? 50 : 20) // solo completion bonus
  ));
}
function getLevel(xp) {
  if (xp <= 0) return 1;
  return Math.max(1, Math.floor((-350 + Math.sqrt(202500 + 200 * xp)) / 100));
}

//  GET /api/stats/global 
router.get('/global', async (_req, res) => {
  try {
    const [usersRes, statsRes] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('stats').select('games_played, time_played_ms, total_lines'),
    ]);

    const totalPlayers = usersRes.count || 0;
    let totalGames = 0, totalTimeMs = 0, totalLines = 0;
    for (const row of statsRes.data || []) {
      totalGames   += row.games_played  || 0;
      totalTimeMs  += row.time_played_ms || 0;
      totalLines   += row.total_lines   || 0;
    }

    res.json({ total_players: totalPlayers, total_games: totalGames, total_time_ms: totalTimeMs, total_lines: totalLines });
  } catch (err) {
    console.error('GET /api/stats/global:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/stats/solo 
router.post('/solo', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      mode = 'marathon',
      score = 0, lines = 0, level = 1,
      time_ms: time_ms_snake = 0, timeMs = 0,
      tetrises = 0,
      t_spins = 0,   tSpins = 0,
      b2b_max = 0,   b2bMax = 0,
      max_combo = 0, maxCombo = 0,
    } = req.body || {};
    const time_ms  = time_ms_snake || timeMs   || 0;
    const t_spins_ = t_spins       || tSpins   || 0;
    const b2b_max_ = b2b_max       || b2bMax   || 0;
    const max_combo_ = max_combo   || maxCombo || 0;

    const xpGained = calcXpGainSolo({ lines, tetrises, tSpins: t_spins_, durationMs: time_ms, mode });

    // Fetch current stats + xp
    const [{ data: statsRow }, { data: userRow }] = await Promise.all([
      supabase.from('stats').select('*').eq('user_id', userId).single(),
      supabase.from('users').select('xp').eq('id', userId).single(),
    ]);

    const cur = statsRow || {};
    const newXp  = (userRow?.xp || 0) + xpGained;
    const oldLvl = getLevel(userRow?.xp || 0);
    const newLvl = getLevel(newXp);

    const updates = {
      games_played:  (cur.games_played  || 0) + 1,
      total_lines:   (cur.total_lines   || 0) + lines,
      total_score:   (cur.total_score   || 0) + score,
      tetrises:      (cur.tetrises      || 0) + tetrises,
      t_spins:       (cur.t_spins       || 0) + t_spins_,
      time_played_ms: (cur.time_played_ms || 0) + time_ms,
      solo_played:   (cur.solo_played   || 0) + 1,
      solo_lines:    (cur.solo_lines    || 0) + lines,
      solo_time_played_ms: (cur.solo_time_played_ms || 0) + time_ms,
    };

    if (mode === 'marathon') {
      updates.marathon_played         = (cur.marathon_played || 0) + 1;
      updates.marathon_total_lines    = (cur.marathon_total_lines || 0) + lines;
      updates.marathon_time_played_ms = (cur.marathon_time_played_ms || 0) + time_ms;
      updates.marathon_tetrises       = (cur.marathon_tetrises || 0) + tetrises;
      updates.marathon_t_spins        = (cur.marathon_t_spins || 0) + t_spins_;
      if (score     > (cur.marathon_best_score || 0)) updates.marathon_best_score = score;
      if (lines     > (cur.marathon_best_lines || 0)) updates.marathon_best_lines = lines;
      if (level     > (cur.marathon_max_level  || 0)) updates.marathon_max_level  = level;
      if (max_combo_ > (cur.marathon_max_combo || 0)) updates.marathon_max_combo = max_combo_;
      if (b2b_max_   > (cur.marathon_b2b_max   || 0)) updates.marathon_b2b_max   = b2b_max_;
    }

    // Global bests
    if (score     > (cur.best_score  || 0)) updates.best_score  = score;
    if (lines     > (cur.best_lines  || 0)) updates.best_lines  = lines;
    if (level     > (cur.max_level   || 0)) updates.max_level   = level;
    if (max_combo_ > (cur.max_combo  || 0)) updates.max_combo   = max_combo_;
    if (b2b_max_   > (cur.b2b_max    || 0)) updates.b2b_max     = b2b_max_;
    if (score     > (cur.solo_best_score || 0)) updates.solo_best_score = score;

    await Promise.all([
      supabase.from('stats').upsert({ user_id: userId, ...updates }),
      supabase.from('users').update({ xp: newXp, updated_at: new Date().toISOString() }).eq('id', userId),
    ]);

    res.json({ ok: true, xpGained, xp: newXp, level: newLvl, leveledUp: newLvl > oldLvl });
  } catch (err) {
    console.error('POST /api/stats/solo:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  GET /api/stats/me 
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('stats').select('*').eq('user_id', req.user.id).single();
    res.json({ stats: data || {} });
  } catch (err) {
    console.error('GET /api/stats/me:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});
