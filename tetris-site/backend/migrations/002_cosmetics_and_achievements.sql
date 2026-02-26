-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 002: Cosmetics & Achievements                     ║
-- ║  Run once in Supabase SQL Editor.                            ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── 1. COSMETICS CATALOGUE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cosmetics (
  slug        TEXT PRIMARY KEY,        -- e.g. 'border-fire', 'title-casual'
  type        TEXT NOT NULL CHECK (type IN ('border', 'title')),
  name        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
  description TEXT,
  icon        TEXT                      -- emoji or asset key
);

-- ── 2. USER COSMETIC INVENTORY ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_cosmetics (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cosmetic_slug  TEXT NOT NULL REFERENCES public.cosmetics(slug) ON DELETE CASCADE,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, cosmetic_slug)
);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON public.user_cosmetics(user_id);

-- ── 3. ACHIEVEMENTS CATALOGUE ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.achievements (
  slug               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  rarity             TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
  icon               TEXT,
  progress_total     INTEGER NOT NULL DEFAULT 1,  -- goal value; 1 = single trigger
  reward_border_slug TEXT REFERENCES public.cosmetics(slug) ON DELETE SET NULL,
  reward_title_slug  TEXT REFERENCES public.cosmetics(slug) ON DELETE SET NULL
);

-- ── 4. USER ACHIEVEMENT PROGRESS ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  achievement_slug TEXT NOT NULL REFERENCES public.achievements(slug) ON DELETE CASCADE,
  progress         INTEGER NOT NULL DEFAULT 0,
  earned           BOOLEAN NOT NULL DEFAULT FALSE,
  earned_at        TIMESTAMPTZ,
  UNIQUE (user_id, achievement_slug)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);

-- ── 5. EQUIP COLUMNS ON PROFILES ───────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS equipped_border TEXT REFERENCES public.cosmetics(slug) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS equipped_title  TEXT REFERENCES public.cosmetics(slug) ON DELETE SET NULL;

-- ── 6. EXTRA TRACKING COLUMNS ON STATS ─────────────────────────
ALTER TABLE public.stats
  ADD COLUMN IF NOT EXISTS win_streak_current      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_streak_max          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tspin_triples           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finesse_perfect_games   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garbage_sent_max_single INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_hold_wins            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comeback_wins           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zero_garbage_wins       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS all_clear_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS all_clear_sprint        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_streak_current     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_streak_max         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_played_date        DATE,
  ADD COLUMN IF NOT EXISTS pieces_placed           BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rainbow_games           INTEGER NOT NULL DEFAULT 0;

-- ── 7. SEED: BORDER COSMETICS ──────────────────────────────────
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('border-default',    'border', 'Default',      'common',     'The standard border.',                               '⬜'),
  ('border-bronze',     'border', 'Bronze',        'uncommon',   'Warm bronze rotating ring.',                         '🟫'),
  ('border-silver',     'border', 'Silver',        'uncommon',   'Gleaming silver light streaks.',                     '⬛'),
  ('border-neon-green', 'border', 'Neon Green',    'uncommon',   'Electric green ripple pulse.',                       '💚'),
  ('border-neon-cyan',  'border', 'Neon Cyan',     'uncommon',   'Dual breathing cyan rings.',                         '🩵'),
  ('border-gold',       'border', 'Gold',          'rare',       'Three orbiting golden orbs.',                        '🟡'),
  ('border-storm',      'border', 'Storm',         'rare',       'Crackling electric lightning arcs.',                 '⛈️'),
  ('border-fire',       'border', 'Fire',          'rare',       'Blazing upward flame burst.',                        '🔥'),
  ('border-rainbow',    'border', 'Rainbow',       'mythic',     'Full-spectrum counter-spinning colour wheel.',       '🌈'),
  ('border-neon-purple','border', 'Neon Purple',   'rare',       'Soft pulsing purple glow.',                          '💜'),
  ('border-neon-pink',  'border', 'Neon Pink',     'epic',       'Theatrical flickering pink rings.',                  '🩷'),
  ('border-diamond',    'border', 'Diamond',       'legendary',  'Crystal-clear prismatic flash.',                     '💎'),
  ('border-toxic',      'border', 'Toxic',         'epic',       'Rising bubbling green hazard.',                      '☣️'),
  ('border-ice',        'border', 'Ice',           'epic',       'Frost arc sweeping cold crescent.',                  '❄️'),
  ('border-molten',     'border', 'Molten',        'legendary',  'Ember sparks and lava glow below.',                  '🌋'),
  ('border-glitch',     'border', 'Glitch',        'epic',       'RGB channel-split corruption.',                      '📡'),
  ('border-void',       'border', 'Void',          'epic',       'Dark purple wisp arcs, pulsing inward.',             '🌑'),
  ('border-galaxy',     'border', 'Galaxy',        'epic',       'Nebula arc segments drifting in orbit.',             '🌌'),
  ('border-ghost',      'border', 'Ghost',         'epic',       'Fading in and out of visibility.',                   '👻'),
  ('border-pixel',      'border', 'Pixel',         'epic',       'CRT scanlines with 8-bit corner brackets.',          '👾'),
  ('border-bloodmoon',  'border', 'Blood Moon',    'epic',       'Moon-phase shadow sliding over blood-red ring.',     '🩸'),
  ('border-obsidian',   'border', 'Obsidian',      'legendary',  'Dark volcanic glass with sharp silver glints.',      '💀'),
  ('border-solar',      'border', 'Solar',         'legendary',  'Eight sharp sunray segments rotating outward.',      '☀️'),
  ('border-challenger', 'border', 'Challenger',    'legendary',  'Blazing fast dual-layer fire crown.',                '👑'),
  ('border-tetromino',  'border', 'Tetromino',     'mythic',     'Spinning segmented ring in all seven piece colours.','🟦'),
  ('border-astral',     'border', 'Astral',        'mythic',     'Gold light-burst rays, divine crown energy.',        '🌟')
ON CONFLICT (slug) DO NOTHING;

-- ── 8. SEED: TITLE COSMETICS ───────────────────────────────────
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('title-casual',       'title', 'Casual',        'common',     NULL, '🎮'),
  ('title-new-blood',    'title', 'New Blood',      'common',     NULL, '📦'),
  ('title-returner',     'title', 'Returner',       'common',     NULL, '🔁'),
  ('title-veteran',      'title', 'Veteran',        'uncommon',   NULL, '🕹️'),
  ('title-marathoner',   'title', 'Marathoner',     'uncommon',   NULL, '🏁'),
  ('title-squad-up',     'title', 'Squad Up',       'uncommon',   NULL, '🤝'),
  ('title-silver-stripes','title','Silver Stripes', 'uncommon',   NULL, '🥈'),
  ('title-line-clearer', 'title', 'Line Clearer',   'uncommon',   NULL, '🧱'),
  ('title-grinder',      'title', 'Grinder',        'uncommon',   NULL, '📈'),
  ('title-speed-demon',  'title', 'Speed Demon',    'rare',       NULL, '⚡'),
  ('title-on-fire',      'title', 'On Fire',        'rare',       NULL, '🔥'),
  ('title-back-to-back', 'title', 'Back-to-Back',   'rare',       NULL, '🌊'),
  ('title-prism',        'title', 'Prism',          'rare',       NULL, '🌈'),
  ('title-sharpshooter', 'title', 'Sharpshooter',   'rare',       NULL, '🎯'),
  ('title-ironclad',     'title', 'Ironclad',       'rare',       NULL, '🎖️'),
  ('title-diamond-status','title','Diamond Status', 'rare',       NULL, '💎'),
  ('title-flood',        'title', 'Flood',          'rare',       NULL, '💧'),
  ('title-cold-blooded', 'title', 'Cold-Blooded',   'epic',       NULL, '🧊'),
  ('title-showboat',     'title', 'Showboat',       'epic',       NULL, '🎪'),
  ('title-no-hold',      'title', 'No Hold',        'epic',       NULL, '☣️'),
  ('title-glitched-out', 'title', 'Glitched Out',   'epic',       NULL, '📡'),
  ('title-void-walker',  'title', 'Void Walker',    'epic',       NULL, '💜'),
  ('title-infinite-loop','title', 'Infinite Loop',  'epic',       NULL, '🌀'),
  ('title-the-phantom',  'title', 'The Phantom',    'epic',       NULL, '👻'),
  ('title-8-bit',        'title', '8-Bit',          'epic',       NULL, '💻'),
  ('title-survivor',     'title', 'Survivor',       'epic',       NULL, '🩸'),
  ('title-no-mercy',     'title', 'No Mercy',       'legendary',  NULL, '💀'),
  ('title-solar-flare',  'title', 'Solar Flare',    'legendary',  NULL, '☀️'),
  ('title-molten-core',  'title', 'Molten Core',    'legendary',  NULL, '🌋'),
  ('title-tetris-king',  'title', 'Tetris King',    'legendary',  NULL, '👑'),
  ('title-the-champion', 'title', 'The Champion',   'legendary',  NULL, '🏆'),
  ('title-galaxy-brain', 'title', 'Galaxy Brain',   'mythic',     NULL, '🌌'),
  ('title-transcendent', 'title', 'Transcendent',   'mythic',     NULL, '✨'),
  ('title-god-of-tetris','title', 'God of Tetris',  'mythic',     NULL, '🎆')
ON CONFLICT (slug) DO NOTHING;

-- ── 9. SEED: ACHIEVEMENTS ──────────────────────────────────────
INSERT INTO public.achievements
  (slug, name, description, rarity, icon, progress_total, reward_border_slug, reward_title_slug)
VALUES
  -- Common
  ('first-drop',       'First Drop',        'Play your very first game.',                                 'common',     '🎮', 1,    'border-default',     'title-casual'),
  ('welcome-aboard',   'Welcome Aboard',    'Register an account.',                                       'common',     '📦', 1,    'border-default',     'title-new-blood'),
  ('long-time-no-see', 'Long Time No See',  'Log back in after being away for 30 or more days.',          'common',     '🔁', 1,    'border-default',     'title-returner'),
  -- Uncommon
  ('veteran-presence', 'Veteran Presence',  'Play 50 total games.',                                       'uncommon',   '🕹️', 50,   'border-bronze',      'title-veteran'),
  ('sprint-debut',     'Sprint Debut',      'Complete your first 40-line sprint run.',                    'uncommon',   '🏁', 1,    'border-bronze',      'title-marathoner'),
  ('team-player',      'Team Player',       'Play 20 co-op games with a partner.',                        'uncommon',   '🤝', 20,   'border-neon-cyan',   'title-squad-up'),
  ('silver-lining',    'Silver Lining',     'Reach Silver rank on the ranked ladder.',                    'uncommon',   '🥈', 1,    'border-silver',      'title-silver-stripes'),
  ('line-mind',        'Line Mind',         'Clear 1,000 lines across all games.',                        'uncommon',   '🧱', 1000, 'border-neon-green',  'title-line-clearer'),
  ('century-mark',     'Century Mark',      'Play 100 total games.',                                      'uncommon',   '📈', 100,  'border-bronze',      'title-grinder'),
  -- Rare
  ('speed-demon',      'Speed Demon',       'Complete a 40-line sprint in under 60 seconds.',             'rare',       '⚡', 1,    'border-neon-purple', 'title-speed-demon'),
  ('on-fire',          'On Fire',           'Win 5 games in a row.',                                      'rare',       '🔥', 5,    'border-fire',        'title-on-fire'),
  ('b2b-king',         'B2B King',          'Land 5 back-to-back Tetrises in a single game.',             'rare',       '🌊', 5,    'border-molten',      'title-back-to-back'),
  ('rainbow-run',      'Rainbow Run',       'Place all 7 tetromino types in one game without topping out.','rare',      '🌈', 1,    'border-rainbow',     'title-prism'),
  ('sharpshooter',     'Sharpshooter',      'Finish 20 games with zero finesse errors.',                  'rare',       '🎯', 20,   'border-storm',       'title-sharpshooter'),
  ('gold-rush',        'Gold Rush',         'Climb to Gold rank on the ranked ladder.',                   'rare',       '🥇', 1,    'border-gold',        'title-ironclad'),
  ('diamond-status',   'Diamond Status',    'Reach Diamond rank on the ranked ladder.',                   'rare',       '💎', 1,    'border-diamond',     'title-diamond-status'),
  ('under-pressure',   'Under Pressure',    'Send 100 garbage lines in a single game.',                   'rare',       '💧', 100,  'border-toxic',       'title-flood'),
  -- Epic
  ('cold-blooded',     'Cold-Blooded',      'Win 10 comeback games from critical board height.',          'epic',       '🧊', 10,   'border-ice',         'title-cold-blooded'),
  ('showboat',         'Showboat',          'Land a T-spin triple 25 times.',                             'epic',       '🎪', 25,   'border-neon-pink',   'title-showboat'),
  ('toxic-play',       'Toxic Play',        'Win 5 ranked games without ever using the hold piece.',      'epic',       '☣️', 5,    'border-toxic',       'title-no-hold'),
  ('glitched-out',     'Glitched Out',      'Report a verified bug that gets patched. One of a kind.',    'epic',       '📡', 1,    'border-glitch',      'title-glitched-out'),
  ('void-walker',      'Void Walker',       'Reach Grandmaster rank on the ranked ladder.',               'epic',       '🌑', 1,    'border-void',        'title-void-walker'),
  ('infinite-loop',    'Infinite Loop',     'Play 1,000 total games.',                                    'epic',       '🌀', 1000, 'border-galaxy',      'title-infinite-loop'),
  ('the-phantom',      'The Phantom',       'Win a ranked game without receiving any garbage lines.',     'epic',       '👻', 1,    'border-ghost',       'title-the-phantom'),
  ('8-bit-brain',      '8-Bit Brain',       'Complete a sprint with at least one All-Clear.',             'epic',       '👾', 1,    'border-pixel',       'title-8-bit'),
  ('near-death',       'Near Death',        'Win 10 games after your board reached the top 2 rows.',      'epic',       '🩸', 10,   'border-bloodmoon',   'title-survivor'),
  -- Legendary
  ('no-mercy',         'No Mercy',          'Win 20 games in a row without a single loss.',               'legendary',  '💀', 20,   'border-obsidian',    'title-no-mercy'),
  ('committed',        'Committed',         'Log in and play at least one game for 7 consecutive days.',  'legendary',  '☀️', 7,    'border-solar',       'title-solar-flare'),
  ('molten-core',      'Molten Core',       'Reach 1,500 ELO rating.',                                    'legendary',  '🌋', 1,    'border-molten',      'title-molten-core'),
  ('tetris-king',      'Tetris King',       'Reach Challenger rank — the highest tier in the game.',      'legendary',  '👑', 1,    'border-challenger',  'title-tetris-king'),
  ('the-champion',     'The Champion',      'End a full ranked season as the #1 player in your region.',  'legendary',  '🏆', 1,    'border-diamond',     'title-the-champion'),
  -- Mythic
  ('galaxy-brain',     'Galaxy Brain',      'Place 10,000 pieces across all games.',                      'mythic',     '🌌', 10000,'border-tetromino',   'title-galaxy-brain'),
  ('transcendent',     'Transcendent',      'Unlock every other achievement in the game.',                'mythic',     '✨', 1,    'border-rainbow',     'title-transcendent'),
  ('god-of-tetris',    'God of Tetris',     'Hold the #1 position on the all-time ELO leaderboard.',     'mythic',     '🎆', 1,    'border-astral',      'title-god-of-tetris')
ON CONFLICT (slug) DO NOTHING;
