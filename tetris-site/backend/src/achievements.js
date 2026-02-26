import { createNotification } from './notifications.js';

/**
 * Achievement definitions and check logic.
 *
 * context object passed to checkAndUpdateAchievements:
 * {
 *   mode:            'versus' | 'sprint' | 'coop' | 'solo' | 'registered' | 'return'
 *   isWinner:        boolean
 *   garbageSent:     number  (versus)
 *   noHold:          boolean (game was played without touching hold)
 *   allClear:        boolean (sprint all-clear occurred)
 *   rainbow:         boolean (played using all 7 piece types without topping out)
 *   piecesPlaced:    number
 *   garbageReceived: number  (versus)
 *   comebackWin:     boolean (won while board was at row 18+)
 *   finessePerfect:  boolean (zero finesse errors)
 *   tspinTriples:    number  (tspin triples THIS game)
 *   sprintTimeMs:    number  (sprint finish time in ms, 0 if not sprint)
 *   currentElo:      number  (included so we don't need an extra fetch)
 * }
 */

// ── Achievement definitions ────────────────────────────────────────────────
// Each entry has:
//   slug           – matches DB slug
//   progressTotal  – goal value  (must match DB progress_total)
//   check(elo, stats, ctx) → number  (current progress toward goal, capped at progressTotal)
//   grantRewards   – whether to auto-grant cosmetics on earn (false = manual/admin only)

const DEFINITIONS = [
  // ── COMMON ──────────────────────────────────────────────────────────────
  {
    slug: 'first-drop',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 1),
  },
  {
    slug: 'welcome-aboard',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, _stats, ctx) => ctx.mode === 'registered' ? 1 : 0,
  },
  {
    slug: 'long-time-no-see',
    progressTotal: 1,
    grantRewards: true,
    // Resolved inside checkAndUpdateAchievements via last_played_date gap
    check: (_elo, _stats, ctx) => ctx.mode === 'return' ? 1 : 0,
  },
  // ── UNCOMMON ─────────────────────────────────────────────────────────────
  {
    slug: 'veteran-presence',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 50),
  },
  {
    slug: 'sprint-debut',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.sprint_played ?? 0, 1),
  },
  {
    slug: 'team-player',
    progressTotal: 20,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_played ?? 0, 20),
  },
  {
    slug: 'silver-lining',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1200 ? 1 : 0,
  },
  {
    slug: 'line-mind',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.total_lines ?? 0, 1000),
  },
  {
    slug: 'century-mark',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 100),
  },
  // ── RARE ─────────────────────────────────────────────────────────────────
  {
    slug: 'speed-demon',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => {
      const t = stats.best_sprint_ms ?? 0;
      return (t > 0 && t <= 60000) ? 1 : 0;
    },
  },
  {
    slug: 'on-fire',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 5),
  },
  {
    slug: 'b2b-king',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.b2b_max ?? 0, 5),
  },
  {
    slug: 'rainbow-run',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.rainbow_games ?? 0, 1),
  },
  {
    slug: 'sharpshooter',
    progressTotal: 20,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.finesse_perfect_games ?? 0, 20),
  },
  {
    slug: 'gold-rush',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1400 ? 1 : 0,
  },
  {
    slug: 'platinum-peak',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1600 ? 1 : 0,
  },
  {
    slug: 'diamond-status',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1800 ? 1 : 0,
  },
  {
    slug: 'under-pressure',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_sent_max_single ?? 0, 100),
  },
  // ── EPIC ─────────────────────────────────────────────────────────────────
  {
    slug: 'cold-blooded',
    progressTotal: 10,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.comeback_wins ?? 0, 10),
  },
  {
    slug: 'showboat',
    progressTotal: 25,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.tspin_triples ?? 0, 25),
  },
  {
    slug: 'toxic-play',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.no_hold_wins ?? 0, 5),
  },
  {
    slug: 'glitched-out',
    progressTotal: 1,
    grantRewards: false, // manually granted by admin
    check: () => 0,
  },
  {
    slug: 'masters-degree',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2000 ? 1 : 0,
  },
  {
    slug: 'grandmaster-gambit',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2100 ? 1 : 0,
  },
  {
    slug: 'void-walker',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2200 ? 1 : 0,
  },
  {
    slug: 'infinite-loop',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 1000),
  },
  {
    slug: 'the-phantom',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.zero_garbage_wins ?? 0, 1),
  },
  {
    slug: '8-bit-brain',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.all_clear_sprint ?? 0, 1),
  },
  {
    slug: 'near-death',
    progressTotal: 20,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.comeback_wins ?? 0, 20),
  },
  // ── LEGENDARY ────────────────────────────────────────────────────────────
  {
    slug: 'no-mercy',
    progressTotal: 20,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 20),
  },
  {
    slug: 'committed',
    progressTotal: 7,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.days_streak_max ?? 0, 7),
  },
  {
    slug: 'molten-core',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1500 ? 1 : 0,
  },
  {
    slug: 'tetris-king',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2300 ? 1 : 0,
  },
  {
    slug: 'the-champion',
    progressTotal: 1,
    grantRewards: false, // manually granted by admin at season end
    check: () => 0,
  },
  // ── MYTHIC ───────────────────────────────────────────────────────────────
  {
    slug: 'galaxy-brain',
    progressTotal: 10000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.pieces_placed ?? 0, 10000),
  },
  {
    slug: 'transcendent',
    progressTotal: 1,
    grantRewards: true,
    // resolved last, after all other earns are finalised
    check: () => 0,
  },
  {
    slug: 'god-of-tetris',
    progressTotal: 1,
    grantRewards: false, // manually granted
    check: () => 0,
  },
  // ── NEW DEFINITIONS (activated — requires DB migration 006) ─────────────
  // ── COMMON (new) ──────────────────────────────────────────────────────────
  {
    slug: 'versus-debut',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.versus_played ?? 0, 1),
  },
  {
    slug: 'coop-debut',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_played ?? 0, 1),
  },
  {
    slug: 'first-win',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.versus_won ?? 0, 1),
  },
  {
    slug: 'line-clear',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.total_lines ?? 0, 1),
  },


  {
    slug: 'block-starter',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 5),
  },

  // ── UNCOMMON (new) ────────────────────────────────────────────────────────
  {
    slug: 'hat-trick',
    progressTotal: 3,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 3),
  },
  {
    slug: 'grind-time',
    progressTotal: 200,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 200),
  },
  {
    slug: 'sprint-runner',
    progressTotal: 10,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.sprint_played ?? 0, 10),
  },
  {
    slug: 'speedster',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => {
      const t = stats.best_sprint_ms ?? 0;
      return (t > 0 && t <= 120000) ? 1 : 0;
    },
  },
  {
    slug: 'combo-curious',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => (stats.max_combo ?? 0) >= 5 ? 1 : 0,
  },
  {
    slug: 'garbage-getter',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_received_total ?? 0, 500),
  },
  {
    slug: 'line-worker',
    progressTotal: 5000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.total_lines ?? 0, 5000),
  },
  {
    slug: 'bronze-tier',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1050 ? 1 : 0,
  },
  {
    slug: 'coop-crew',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_played ?? 0, 50),
  },

  // ── RARE (new) ────────────────────────────────────────────────────────────
  {
    slug: 'double-digit-streak',
    progressTotal: 10,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 10),
  },
  {
    slug: 'b2b-master',
    progressTotal: 10,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.b2b_max ?? 0, 10),
  },
  {
    slug: 'sprint-ace',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => {
      const t = stats.best_sprint_ms ?? 0;
      return (t > 0 && t <= 45000) ? 1 : 0;
    },
  },
  {
    slug: 'finesse-fifty',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.finesse_perfect_games ?? 0, 50),
  },
  {
    slug: 'tspin-rookie',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.t_spins ?? 0, 5),
  },
  {
    slug: 'wall-street',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_sent_total ?? 0, 1000),
  },
  {
    slug: 'garbage-wall',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_received_max_single ?? 0, 20),
  },
  {
    slug: 'comeback-kid',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.comeback_wins ?? 0, 1),
  },
  {
    slug: 'challenger-tier',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1700 ? 1 : 0,
  },
  {
    slug: 'sprint-200',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.sprint_played ?? 0, 50),
  },
  {
    slug: 'duo-dynamic',
    progressTotal: 10,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_won ?? 0, 10),
  },

  {
    slug: 'block-stacker',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.tetrises ?? 0, 100),
  },

  // ── EPIC (new) ────────────────────────────────────────────────────────────
  {
    slug: 'tspin-hunter',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.tspin_triples ?? 0, 100),
  },
  {
    slug: 'no-hold-hero',
    progressTotal: 15,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.no_hold_wins ?? 0, 15),
  },
  {
    slug: 'ice-cold',
    progressTotal: 25,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.comeback_wins ?? 0, 25),
  },
  {
    slug: 'obsidian-rank',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 1900 ? 1 : 0,
  },
  {
    slug: 'sprint-sub30',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => {
      const t = stats.best_sprint_ms ?? 0;
      return (t > 0 && t <= 30000) ? 1 : 0;
    },
  },
  {
    slug: 'all-clear-king',
    progressTotal: 5,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.all_clear_sprint ?? 0, 5),
  },
  {
    slug: 'galaxy-grind',
    progressTotal: 50000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.pieces_placed ?? 0, 50000),
  },
  {
    slug: 'demolisher',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => (stats.garbage_sent_max_single ?? 0) >= 200 ? 1 : 0,
  },
  {
    slug: 'five-star',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.versus_won ?? 0, 500),
  },
  {
    slug: 'no-miss',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.finesse_perfect_games ?? 0, 100),
  },
  {
    slug: 'coop-champion',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_won ?? 0, 100),
  },
  {
    slug: 'quad-stacker',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.tetrises ?? 0, 500),
  },
  {
    slug: 'ghost-runs',
    progressTotal: 2000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 2000),
  },
  {
    slug: 'under-siege',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_received_total ?? 0, 1000),
  },

  // ── LEGENDARY (new) ───────────────────────────────────────────────────────
  {
    slug: 'machine',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.versus_won ?? 0, 1000),
  },
  {
    slug: 'sprint-godspeed',
    progressTotal: 1,
    grantRewards: true,
    check: (_elo, stats) => {
      const t = stats.best_sprint_ms ?? 0;
      return (t > 0 && t <= 20000) ? 1 : 0;
    },
  },
  {
    slug: 'seven-day-saint',
    progressTotal: 30,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.days_streak_max ?? 0, 30),
  },
  {
    slug: 'legendary-streak',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 50),
  },
  {
    slug: 'fire-rain',
    progressTotal: 10000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_sent_total ?? 0, 10000),
  },
  {
    slug: 'immortal',
    progressTotal: 5000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 5000),
  },
  {
    slug: 'all-clear-god',
    progressTotal: 50,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.all_clear_sprint ?? 0, 50),
  },
  {
    slug: 'tspin-master',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.tspin_triples ?? 0, 500),
  },
  {
    slug: 'astral-realm',
    progressTotal: 500000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.pieces_placed ?? 0, 500000),
  },
  {
    slug: 'iron-mind',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.finesse_perfect_games ?? 0, 500),
  },
  {
    slug: 'platinum-league',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2050 ? 1 : 0,
  },
  {
    slug: 'diamond-league',
    progressTotal: 1,
    grantRewards: true,
    check: (elo) => elo >= 2150 ? 1 : 0,
  },
  {
    slug: 'coop-legend',
    progressTotal: 500,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.coop_won ?? 0, 500),
  },

  // ── MYTHIC (new) ──────────────────────────────────────────────────────────
  {
    slug: 'time-lord',
    progressTotal: 10000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.games_played ?? 0, 10000),
  },
  {
    slug: 'eternal-grind',
    progressTotal: 1000000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.pieces_placed ?? 0, 1000000),
  },
  {
    slug: 'the-untouchable',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.win_streak_max ?? 0, 100),
  },
  {
    slug: 'true-king',
    progressTotal: 10000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.versus_won ?? 0, 10000),
  },
  {
    slug: 'void-master',
    progressTotal: 100000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.garbage_sent_total ?? 0, 100000),
  },
  {
    slug: 'perfect-run',
    progressTotal: 1000,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.finesse_perfect_games ?? 0, 1000),
  },
  {
    slug: 'rainbow-eternal',
    progressTotal: 100,
    grantRewards: true,
    check: (_elo, stats) => Math.min(stats.rainbow_games ?? 0, 100),
  },
  {
    slug: 'the-absolute',
    progressTotal: 1,
    grantRewards: false, // manually granted to #1 all-time
    check: () => 0,
  },
];

// Slugs that count toward 'transcendent' (excludes itself + manual-only)
const TRANSCENDENT_EXCLUDES = new Set([
  'transcendent', 'god-of-tetris', 'glitched-out', 'the-champion', 'the-absolute',
]);
const TRANSCENDENT_SLUGS = DEFINITIONS
  .filter(d => !TRANSCENDENT_EXCLUDES.has(d.slug))
  .map(d => d.slug);

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Check all achievements for a user and update their progress rows.
 * Grants cosmetics for newly earned achievements.
 *
 * @param {string} userId
 * @param {object} supabase  – Supabase service-role client
 * @param {object} context   – game-event context (see top of file)
 * @returns {Promise<{ newlyEarned: string[] }>}
 */
export async function checkAndUpdateAchievements(userId, supabase, context = {}) {
  // ── 1. Fetch current stats + elo ────────────────────────────────────────
  const [{ data: user }, { data: stats }] = await Promise.all([
    supabase.from('users').select('elo').eq('id', userId).single(),
    supabase.from('stats').select('*').eq('user_id', userId).single(),
  ]);

  if (!stats) return { newlyEarned: [] };

  const elo = user?.elo ?? 0;

  // ── 2. Fetch existing progress rows ─────────────────────────────────────
  const { data: existing } = await supabase
    .from('user_achievements')
    .select('achievement_slug, progress, earned')
    .eq('user_id', userId);

  const existingMap = {};
  for (const row of existing ?? []) {
    existingMap[row.achievement_slug] = row;
  }

  // ── 3. Compute updated progress for each definition ─────────────────────
  const upsertRows = [];
  const newlyEarned = [];
  let earnedSet = new Set(
    (existing ?? []).filter(r => r.earned).map(r => r.achievement_slug)
  );

  for (const def of DEFINITIONS) {
    if (def.slug === 'transcendent') continue; // resolved below

    const prev = existingMap[def.slug];
    if (prev?.earned) continue; // already earned, skip

    const newProgress = def.check(elo, stats, context);
    const prevProgress = prev?.progress ?? 0;
    if (newProgress <= prevProgress) continue; // no change

    const justEarned = newProgress >= def.progressTotal;
    upsertRows.push({
      user_id: userId,
      achievement_slug: def.slug,
      progress: newProgress,
      earned: justEarned,
      earned_at: justEarned ? new Date().toISOString() : null,
    });

    if (justEarned) {
      newlyEarned.push(def.slug);
      earnedSet.add(def.slug);
    }
  }

  // ── 4. Resolve 'transcendent' ───────────────────────────────────────────
  const transcDef = DEFINITIONS.find(d => d.slug === 'transcendent');
  if (transcDef && !existingMap['transcendent']?.earned) {
    const allEarned = TRANSCENDENT_SLUGS.every(s => earnedSet.has(s));
    if (allEarned) {
      upsertRows.push({
        user_id: userId,
        achievement_slug: 'transcendent',
        progress: 1,
        earned: true,
        earned_at: new Date().toISOString(),
      });
      newlyEarned.push('transcendent');
    }
  }

  // ── 5. Persist progress updates ─────────────────────────────────────────
  if (upsertRows.length > 0) {
    await supabase
      .from('user_achievements')
      .upsert(upsertRows, { onConflict: 'user_id,achievement_slug' });
  }

  // ── 6. Grant cosmetic rewards ────────────────────────────────────────────
  if (newlyEarned.length > 0) {
    // Fetch reward slugs + metadata for newly earned achievements
    const { data: achDefs } = await supabase
      .from('achievements')
      .select('slug, name, description, rarity, icon, reward_border_slug, reward_title_slug')
      .in('slug', newlyEarned);

    const cosmetics = [];
    for (const ach of achDefs ?? []) {
      const def = DEFINITIONS.find(d => d.slug === ach.slug);
      if (!def?.grantRewards) continue;
      if (ach.reward_border_slug) {
        cosmetics.push({ user_id: userId, cosmetic_slug: ach.reward_border_slug });
      }
      if (ach.reward_title_slug) {
        cosmetics.push({ user_id: userId, cosmetic_slug: ach.reward_title_slug });
      }
    }

    if (cosmetics.length > 0) {
      await supabase
        .from('user_cosmetics')
        .upsert(cosmetics, { onConflict: 'user_id,cosmetic_slug', ignoreDuplicates: true });
    }

    // ── 7. Inbox notifications ──────────────────────────────────────────
    const notifPayloads = (achDefs ?? []).map(ach => {
      const rewards = [];
      if (ach.reward_border_slug) rewards.push('Border unlocked');
      if (ach.reward_title_slug)  rewards.push('Title unlocked');
      const rewardNote = rewards.length ? ` — ${rewards.join(' & ')}` : '';
      return {
        type:  'achievement',
        title: 'Achievement Unlocked!',
        body:  `${ach.name || ach.slug}${rewardNote}`,
        icon:  ach.icon  || '🏆',
        data:  {
          slug:               ach.slug,
          rarity:             ach.rarity,
          reward_border_slug: ach.reward_border_slug ?? null,
          reward_title_slug:  ach.reward_title_slug  ?? null,
        },
      };
    });
    if (notifPayloads.length > 0) {
      await createNotification(userId, notifPayloads, supabase);
    }
  }

  return { newlyEarned };
}

/**
 * Grant the welcome-aboard achievement and default cosmetics for a new/verified user.
 * Call this once after a user verifies their email.
 */
export async function grantRegistrationRewards(userId, supabase) {
  await Promise.all([
    // default cosmetics
    supabase.from('user_cosmetics').upsert([
      { user_id: userId, cosmetic_slug: 'border-default' },
      { user_id: userId, cosmetic_slug: 'title-casual' },
      { user_id: userId, cosmetic_slug: 'title-new-blood' },
    ], { onConflict: 'user_id,cosmetic_slug', ignoreDuplicates: true }),

    // welcome-aboard achievement
    supabase.from('user_achievements').upsert({
      user_id: userId,
      achievement_slug: 'welcome-aboard',
      progress: 1,
      earned: true,
      earned_at: new Date().toISOString(),
    }, { onConflict: 'user_id,achievement_slug' }),
  ]);
}

/**
 * Update the daily play streak for a user.
 * Call this at the start of any game session.
 * Returns the updated streak values.
 */
export async function updateDailyStreak(userId, supabase) {
  const { data: stats } = await supabase
    .from('stats')
    .select('days_streak_current, days_streak_max, last_played_date')
    .eq('user_id', userId)
    .single();

  if (!stats) return {};

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const last  = stats.last_played_date;

  if (last === today) return {}; // already counted today

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streakCurrent = last === yesterday
    ? (stats.days_streak_current ?? 0) + 1
    : 1;
  const streakMax = Math.max(streakCurrent, stats.days_streak_max ?? 0);

  await supabase.from('stats')
    .update({
      last_played_date: today,
      days_streak_current: streakCurrent,
      days_streak_max: streakMax,
    })
    .eq('user_id', userId);

  return { streakCurrent, streakMax };
}
