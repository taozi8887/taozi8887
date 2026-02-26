-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 006: New achievements, stat columns, rarity corrections   ║
-- ║  Run once in Supabase SQL Editor.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 1. NEW STATS TRACKING COLUMNS ──────────────────────────────────────────
ALTER TABLE public.stats
  ADD COLUMN IF NOT EXISTS garbage_received_total    BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garbage_sent_total        BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garbage_received_max_single INTEGER NOT NULL DEFAULT 0;

-- ── 2. RARITY CORRECTIONS ──────────────────────────────────────────────────
-- Rank tier system: bronze/silver=uncommon, gold/plat=rare, diamond/master=epic,
--                   grandmaster=legendary, challenger=mythic

UPDATE public.cosmetics   SET rarity = 'epic'   WHERE slug = 'border-diamond';
UPDATE public.cosmetics   SET rarity = 'mythic'  WHERE slug = 'border-challenger';
UPDATE public.cosmetics   SET rarity = 'epic'    WHERE slug = 'title-diamond-status';
UPDATE public.cosmetics   SET rarity = 'mythic'  WHERE slug = 'title-tetris-king';
UPDATE public.achievements SET rarity = 'epic'   WHERE slug = 'diamond-status';
UPDATE public.achievements SET rarity = 'mythic'  WHERE slug = 'tetris-king';

-- Fix tetris-king threshold to match Challenger rank (2300 ELO) in description
UPDATE public.achievements
  SET description = 'Reach Challenger rank (2,300+ ELO) — the absolute highest tier.'
  WHERE slug = 'tetris-king';

-- Differentiate near-death from cold-blooded: raise to 20 comeback wins
UPDATE public.achievements
  SET progress_total = 20,
      description    = 'Win 20 games after your board reached the top 2 rows.'
  WHERE slug = 'near-death';

-- Void-walker is no longer a rank duplicate; repurpose description
UPDATE public.achievements
  SET description = 'Surpass 2,200 ELO — elite Grandmaster territory.'
  WHERE slug = 'void-walker';

-- Differentiate block-stacker from quad-stacker
UPDATE public.achievements
  SET progress_total = 100,
      description    = 'Hit 100 Tetrises (four-line clears).'
  WHERE slug = 'block-stacker';

-- ── 3. NEW BORDER COSMETICS ────────────────────────────────────────────────
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('border-hat',          'border', 'Hat Trick',       'uncommon',  'Classic charcoal dashed ring.',                      '🎩'),
  ('border-speedster',    'border', 'Speedster',       'uncommon',  'White motion-streak comet tail.',                    '💨'),
  ('border-combo',        'border', 'Combo',           'uncommon',  'Orange chain-segment pulse.',                        '🔗'),
  ('border-streak',       'border', 'Streak',          'rare',      'Emerald green win-streak pulse.',                    '🔢'),
  ('border-b2b-chain',    'border', 'B2B Chain',       'rare',      'Amber back-to-back chain links.',                    '⛓️'),
  ('border-sprint-ace',   'border', 'Sprint Ace',      'rare',      'Golden speed-dash arc sweep.',                       '🏎️'),
  ('border-comeback',     'border', 'Comeback',        'rare',      'Orange rising resilience glow.',                     '💪'),
  ('border-duo',          'border', 'Duo',             'rare',      'Blue-purple bicolor partner ring.',                  '🤜'),
  ('border-tspin',        'border', 'T-Spin',          'epic',      'Cyan spinning tri-arc.',                             '🌀'),
  ('border-demolisher',   'border', 'Demolisher',      'epic',      'Red explosive shard burst.',                         '💥'),
  ('border-five-star',    'border', 'Five Star',       'epic',      'Gold orbiting star fragments.',                      '⭐'),
  ('border-ghost-run',    'border', 'Ghost Run',       'epic',      'Ethereal silver fade in-out.',                       '👁️'),
  ('border-sub30',        'border', 'Sub-30',          'epic',      'Electric blue-green lightning pulse.',               '⚡'),
  ('border-siege',        'border', 'Siege',           'epic',      'Shield-amber fortress ring.',                        '🛡️'),
  ('border-ice-cold',     'border', 'Ice Cold',        'epic',      'Deep arctic blue freeze arc.',                       '🧊'),
  ('border-machine',      'border', 'Machine',         'legendary', 'Precision silver-blue mechanical cogs.',             '🤖'),
  ('border-godspeed',     'border', 'Godspeed',        'legendary', 'Blinding white speed halo.',                         '💫'),
  ('border-legend',       'border', 'Legend',          'legendary', 'Dark flame tri-ring sparks.',                        '🔱'),
  ('border-fire-rain',    'border', 'Fire Rain',       'legendary', 'Falling ember cannonfire ring.',                     '🌧️'),
  ('border-immortal',     'border', 'Immortal',        'legendary', 'Eternal cyan-white pulse.',                          '⚡'),
  ('border-all-clear',    'border', 'All-Clear',       'legendary', 'Brilliant gold sunray burst.',                       '🌟'),
  ('border-iron',         'border', 'Iron Mind',       'legendary', 'Hard steel gray precision ring.',                    '🧠'),
  ('border-pl-league',    'border', 'Platinum League', 'legendary', 'Enhanced platinum arc sweep.',                       '🪙'),
  ('border-di-league',    'border', 'Diamond League',  'legendary', 'Prismatic diamond flash ring.',                      '💎'),
  ('border-coop-legend',  'border', 'Coop Legend',     'legendary', 'Warm dual-partnership gold-blue ring.',              '🏅'),
  ('border-space',        'border', 'Space',           'legendary', 'Dark nebula purple star-drift.',                     '🌠'),
  ('border-time-lord',    'border', 'Time Lord',       'mythic',    'Teal time-warp reverse-spin.',                      '⏳'),
  ('border-eternal',      'border', 'Eternal',         'mythic',    'Infinity loop purple radiance.',                     '♾️'),
  ('border-untouchable',  'border', 'Untouchable',     'mythic',    'Impenetrable dark indigo fortress.',                 '🛡️'),
  ('border-true-king',    'border', 'True King',       'mythic',    'Royal gold crown radiance halo.',                   '👑'),
  ('border-void-king',    'border', 'Void King',       'mythic',    'Ultra-dark void deeper than Void.',                  '🌑'),
  ('border-perfection',   'border', 'Perfection',      'mythic',    'Pure white precision minimal ring.',                 '🎯'),
  ('border-rainbow-storm','border', 'Rainbow Storm',   'mythic',    'Rainbow spin fused with lightning.',                 '🌈'),
  ('border-absolute',     'border', 'The Absolute',    'mythic',    'All-colour max-glow transcendent halo.',             '✴️')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. NEW TITLE COSMETICS ─────────────────────────────────────────────────
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('title-newcomer',       'title', 'Newcomer',          'common',    'Just starting out.',          '⚔️'),
  ('title-partner',        'title', 'Partner',           'common',    'First co-op game.',           '🤝'),
  ('title-victor',         'title', 'Victor',            'common',    'First win.',                  '🎉'),
  ('title-stacker',        'title', 'Stacker',           'common',    'Early tetris collector.',     '📦'),
  ('title-jogger',         'title', 'Jogger',            'common',    'Sprint finisher.',            '🏁'),
  ('title-hat-trick',      'title', 'Hat Trick',         'uncommon',  'Three in a row.',             '🎩'),
  ('title-road-runner',    'title', 'Road Runner',       'uncommon',  'Sprint under 2 minutes.',     '💨'),
  ('title-crew-member',    'title', 'Crew Member',       'uncommon',  '50 co-op games played.',      '👥'),
  ('title-combo-lord',     'title', 'Combo Lord',        'uncommon',  'Hit a 5-combo.',              '🔗'),
  ('title-wall-builder',   'title', 'Wall Builder',      'uncommon',  'Cleared 5,000 lines.',        '🏗️'),
  ('title-treadmill',      'title', 'On the Treadmill',  'uncommon',  '200 games grinded.',          '⚙️'),
  ('title-on-a-roll',      'title', 'On a Roll',         'rare',      '10-win streak.',              '🔢'),
  ('title-chain-breaker',  'title', 'Chain Breaker',     'rare',      'B2B chain of 10.',            '⛓️'),
  ('title-ace',            'title', 'Ace',               'rare',      'Sprint under 45 seconds.',    '🏎️'),
  ('title-comeback',       'title', 'Comeback',          'rare',      'First comeback win.',         '💪'),
  ('title-challenger-rise','title', 'Challenger Rising', 'rare',      'Reached 1,700 ELO.',          '⭐'),
  ('title-dynamic-duo',    'title', 'Dynamic Duo',       'rare',      '10 co-op wins.',              '🤜'),
  ('title-piece-master',   'title', 'Piece Master',      'rare',      '500 Tetrises landmark.',      '🧩'),
  ('title-tspin-newbie',   'title', 'T-Spin Newbie',     'rare',      'First 5 T-spins.',            '🌀'),
  ('title-warlord',        'title', 'Warlord',           'rare',      '1,000 garbage lines sent.',   '🧱'),
  ('title-spin-doctor',    'title', 'Spin Doctor',       'epic',      '100 T-spin triples.',         '🌀'),
  ('title-bare-handed',    'title', 'Bare-Handed',       'epic',      'Won 15 without hold.',        '✊'),
  ('title-absolute-zero',  'title', 'Absolute Zero',     'epic',      '25 comeback wins.',           '❄️'),
  ('title-the-siege',      'title', 'The Siege',         'epic',      'Took 1,000 total garbage.',   '💠'),
  ('title-sub-30',         'title', 'Sub-30',            'epic',      'Sprint under 30 seconds.',    '⚡'),
  ('title-clear-eyed',     'title', 'Clear-Eyed',        'epic',      '5 sprint all-clears.',        '👁️'),
  ('title-galaxy-grinder', 'title', 'Galaxy Grinder',    'epic',      '50,000 pieces placed.',       '🌌'),
  ('title-nuke',           'title', 'Nuke',              'epic',      '200+ garbage in one game.',   '💥'),
  ('title-five-star',      'title', 'Five-Star',         'epic',      '500 versus wins.',            '⭐'),
  ('title-flawless',       'title', 'Flawless',          'epic',      '100 perfect finesse games.',  '🎯'),
  ('title-coop-champ',     'title', 'Coop Champ',        'epic',      '100 co-op wins.',             '🏅'),
  ('title-phantom-runner', 'title', 'Phantom Runner',    'epic',      '2,000 total games.',          '👻'),
  ('title-under-siege',    'title', 'Under Siege',       'epic',      'Took 1,000 garbage total.',   '🛡️'),
  ('title-obsidian-rank',  'title', 'Obsidian Rank',     'epic',      'Reached 1,900 ELO.',         '💠'),
  ('title-the-machine',    'title', 'The Machine',       'legendary', '1,000 versus wins.',          '🤖'),
  ('title-godspeed',       'title', 'Godspeed',          'legendary', 'Sprint under 20 seconds.',    '💫'),
  ('title-saint',          'title', 'The Saint',         'legendary', '30-day login streak.',        '📅'),
  ('title-legend',         'title', 'Legend',            'legendary', '50-win streak.',               '🔥'),
  ('title-fire-god',       'title', 'Fire God',          'legendary', '10,000 garbage lines sent.',  '🌧️'),
  ('title-immortal',       'title', 'Immortal',          'legendary', '5,000 games played.',         '⚡'),
  ('title-clear-god',      'title', 'Clear God',         'legendary', '50 sprint all-clears.',       '🌟'),
  ('title-spin-lord',      'title', 'Spin Lord',         'legendary', '500 T-spin triples.',         '🌀'),
  ('title-astral',         'title', 'Astral',            'legendary', '500,000 pieces placed.',      '🌠'),
  ('title-iron-will',      'title', 'Iron Will',         'legendary', '500 perfect finesse games.',  '🧠'),
  ('title-platinum-lord',  'title', 'Platinum Lord',     'legendary', 'Reached Platinum League ELO.','🪙'),
  ('title-diamond-lord',   'title', 'Diamond Lord',      'legendary', 'Reached Diamond League ELO.', '💎'),
  ('title-coop-legend',    'title', 'Coop Legend',       'legendary', '500 co-op wins.',             '🏅'),
  ('title-time-lord',      'title', 'Time Lord',         'mythic',    '10,000 games played.',        '⏳'),
  ('title-eternal',        'title', 'Eternal',           'mythic',    '1,000,000 pieces placed.',    '♾️'),
  ('title-untouchable',    'title', 'The Untouchable',   'mythic',    '100-win streak.',              '🛡️'),
  ('title-true-king',      'title', 'True King',         'mythic',    '10,000 versus wins.',         '👑'),
  ('title-void-lord',      'title', 'Void Lord',         'mythic',    '100,000 garbage lines sent.', '🌑'),
  ('title-perfect',        'title', 'Perfect',           'mythic',    '1,000 perfect finesse games.','🎯'),
  ('title-rainbow-lord',   'title', 'Rainbow Lord',      'mythic',    '100 rainbow games.',          '🌈'),
  ('title-the-absolute',   'title', 'The Absolute',      'mythic',    'Admin-granted to #1 all-time.','✴️')
ON CONFLICT (slug) DO NOTHING;

-- ── 5. NEW ACHIEVEMENT ROWS ────────────────────────────────────────────────
-- Cosmetic rewards only set where there is an obvious thematic pairing.
-- All others earn the achievement with no auto-granted cosmetic (intentional).

INSERT INTO public.achievements
  (slug, name, description, rarity, icon, progress_total, reward_border_slug, reward_title_slug)
VALUES
  -- COMMON (new)
  ('versus-debut',       'Versus Debut',        'Play your first versus match.',                          'common',    '⚔️', 1,   NULL,               'title-newcomer'),
  ('coop-debut',         'Coop Debut',           'Play your first co-op match.',                           'common',    '🤝', 1,   NULL,               'title-partner'),
  ('first-win',          'First Win',            'Win your first versus match.',                           'common',    '🎉', 1,   NULL,               'title-victor'),
  ('line-clear',         'Line Clear',           'Clear your first line.',                                 'common',    '✨', 1,   NULL,               NULL),
  ('block-starter',      'Block Starter',        'Complete 5 games.',                                      'common',    '📦', 5,   NULL,               NULL),
  -- UNCOMMON (new)
  ('hat-trick',          'Hat Trick',            'Win 3 matches in a row.',                                'uncommon',  '🎩', 3,   'border-hat',       'title-hat-trick'),
  ('grind-time',         'Grind Time',           'Play 200 games.',                                        'uncommon',  '⚙️', 200, NULL,               'title-treadmill'),
  ('sprint-runner',      'Sprint Runner',        'Finish 10 sprints.',                                     'uncommon',  '🏃', 10,  NULL,               NULL),
  ('speedster',          'Speedster',            'Sprint in under 2 minutes.',                             'uncommon',  '💨', 1,   'border-speedster',  'title-road-runner'),
  ('combo-curious',      'Combo Curious',        'Hit a 5-combo in any game.',                             'uncommon',  '🔗', 1,   NULL,               'title-combo-lord'),
  ('garbage-getter',     'Garbage Getter',       'Receive 500 total garbage lines.',                       'uncommon',  '🗑️', 500, NULL,               NULL),
  ('line-worker',        'Line Worker',          'Clear 5,000 lines.',                                     'uncommon',  '🏗️', 5000,NULL,               'title-wall-builder'),
  ('bronze-tier',        'Bronze Tier',          'Reach 1,050 ELO.',                                       'uncommon',  '🥉', 1,   NULL,               NULL),
  ('coop-crew',          'Coop Crew',            'Play 50 co-op games.',                                   'uncommon',  '👥', 50,  NULL,               'title-crew-member'),
  -- RARE (new)
  ('double-digit-streak','Double Digit Streak',  'Win 10 in a row.',                                       'rare',      '🔟', 10,  'border-streak',    'title-on-a-roll'),
  ('b2b-master',         'B2B Master',           'Land a B2B chain of 10.',                                'rare',      '🏆', 10,  'border-b2b-chain', 'title-chain-breaker'),
  ('sprint-ace',         'Sprint Ace',           'Sprint in under 45 seconds.',                            'rare',      '🏎️', 1,   'border-sprint-ace','title-ace'),
  ('finesse-fifty',      'Finesse Fifty',        '50 games with perfect finesse.',                         'rare',      '🎯', 50,  NULL,               NULL),
  ('tspin-rookie',       'T-Spin Rookie',        'Land 5 T-spins.',                                        'rare',      '🌀', 5,   NULL,               'title-tspin-newbie'),
  ('wall-street',        'Wall Street',          'Send 1,000 total garbage lines.',                        'rare',      '🧱', 1000,NULL,               'title-warlord'),
  ('garbage-wall',       'Garbage Wall',         'Receive 20+ garbage lines in one game.',                 'rare',      '🗑️', 1,   NULL,               NULL),
  ('comeback-kid',       'Comeback Kid',         'Win your first comeback game.',                          'rare',      '💪', 1,   NULL,               'title-comeback'),
  ('challenger-tier',    'Challenger Tier',      'Reach 1,700 ELO.',                                       'rare',      '⭐', 1,   NULL,               'title-challenger-rise'),
  ('sprint-200',         'Marathon Sprinter',    'Finish 50 sprints.',                                     'rare',      '🏃', 50,  NULL,               NULL),
  ('duo-dynamic',        'Duo Dynamic',          'Win 10 co-op matches.',                                  'rare',      '🤜', 10,  'border-duo',       'title-dynamic-duo'),
  ('block-stacker',      'Block Stacker',        'Hit 100 Tetrises (four-line clears).',                   'rare',      '🧊', 100, NULL,               'title-stacker'),
  -- EPIC (new)
  ('tspin-hunter',       'T-Spin Hunter',        '100 T-spin triples.',                                    'epic',      '🌀', 100, 'border-tspin',     'title-spin-doctor'),
  ('no-hold-hero',       'No-Hold Hero',         'Win 15 ranked games without hold.',                      'epic',      '✊', 15,  'border-siege',     'title-bare-handed'),
  ('ice-cold',           'Ice Cold',             '25 comeback wins.',                                      'epic',      '❄️', 25,  'border-ice-cold',  'title-absolute-zero'),
  ('obsidian-rank',      'Obsidian Rank',        'Reach 1,900 ELO.',                                       'epic',      '💠', 1,   NULL,               'title-obsidian-rank'),
  ('sprint-sub30',       'Sub-30 Sprint',        'Sprint in under 30 seconds.',                            'epic',      '⚡', 1,   'border-sub30',     'title-sub-30'),
  ('all-clear-king',     'All-Clear King',       '5 all-clears in sprint.',                                'epic',      '👑', 5,   'border-all-clear', 'title-clear-eyed'),
  ('galaxy-grind',       'Galaxy Grind',         'Place 50,000 pieces.',                                   'epic',      '🌌', 50000,NULL,              'title-galaxy-grinder'),
  ('demolisher',         'Demolisher',           'Send 200+ garbage in one game.',                         'epic',      '💥', 1,   'border-demolisher','title-nuke'),
  ('five-star',          'Five Star',            'Win 500 versus matches.',                                'epic',      '⭐', 500, 'border-five-star', 'title-five-star'),
  ('no-miss',            'No Miss',              '100 games with perfect finesse.',                        'epic',      '🎯', 100, NULL,               'title-flawless'),
  ('coop-champion',      'Coop Champion',        'Win 100 co-op matches.',                                 'epic',      '🏅', 100, NULL,               'title-coop-champ'),
  ('quad-stacker',       'Quad Stacker',         'Hit 500 Tetrises (four-line clears).',                   'epic',      '🟦', 500, NULL,               'title-piece-master'),
  ('ghost-runs',         'Ghost Runs',           'Play 2,000 total games.',                                'epic',      '👁️', 2000,'border-ghost-run', 'title-phantom-runner'),
  ('under-siege',        'Under Siege',          'Receive 1,000 total garbage lines.',                     'epic',      '🛡️', 1000,NULL,               'title-under-siege'),
  -- LEGENDARY (new)
  ('machine',            'Machine',              'Win 1,000 versus matches.',                              'legendary', '🤖', 1000,'border-machine',   'title-the-machine'),
  ('sprint-godspeed',    'Godspeed',             'Sprint in under 20 seconds.',                            'legendary', '💫', 1,   'border-godspeed',  'title-godspeed'),
  ('seven-day-saint',    'Seven-Day Saint',      '30-day login streak.',                                   'legendary', '📅', 30,  NULL,               'title-saint'),
  ('legendary-streak',   'Legendary Streak',     'Win 50 in a row.',                                       'legendary', '🔥', 50,  'border-legend',    'title-legend'),
  ('fire-rain',          'Fire Rain',            'Send 10,000 total garbage lines.',                       'legendary', '🌧️', 10000,'border-fire-rain','title-fire-god'),
  ('immortal',         'Immortal',             'Play 5,000 games.',                                      'legendary', '⚡', 5000,'border-immortal',  'title-immortal'),
  ('all-clear-god',      'All-Clear God',        '50 sprint all-clears.',                                  'legendary', '🌟', 50,  NULL,               'title-clear-god'),
  ('tspin-master',       'T-Spin Master',        '500 T-spin triples.',                                    'legendary', '🌀', 500, NULL,               'title-spin-lord'),
  ('astral-realm',       'Astral Realm',         'Place 500,000 pieces.',                                  'legendary', '🌠', 500000,'border-space',   'title-astral'),
  ('iron-mind',          'Iron Mind',            '500 games with perfect finesse.',                        'legendary', '🧠', 500, 'border-iron',      'title-iron-will'),
  ('platinum-league',    'Platinum League',      'Reach 2,050 ELO.',                                       'legendary', '🪙', 1,   'border-pl-league', 'title-platinum-lord'),
  ('diamond-league',     'Diamond League',       'Reach 2,150 ELO.',                                       'legendary', '💎', 1,   'border-di-league', 'title-diamond-lord'),
  ('coop-legend',        'Coop Legend',          'Win 500 co-op matches.',                                 'legendary', '🏅', 500, 'border-coop-legend','title-coop-legend'),
  -- MYTHIC (new)
  ('time-lord',          'Time Lord',            'Play 10,000 games.',                                     'mythic',    '⏳', 10000,'border-time-lord','title-time-lord'),
  ('eternal-grind',      'Eternal Grind',        'Place 1,000,000 pieces.',                                'mythic',    '♾️', 1000000,'border-eternal','title-eternal'),
  ('the-untouchable',    'The Untouchable',      'Win 100 in a row.',                                      'mythic',    '🛡️', 100, 'border-untouchable','title-untouchable'),
  ('true-king',          'True King',            'Win 10,000 versus matches.',                             'mythic',    '👑', 10000,'border-true-king','title-true-king'),
  ('void-master',        'Void Master',          'Send 100,000 total garbage lines.',                      'mythic',    '🌑', 100000,'border-void-king','title-void-lord'),
  ('perfect-run',        'Perfect Run',          '1,000 games with perfect finesse.',                      'mythic',    '🎯', 1000,'border-perfection','title-perfect'),
  ('rainbow-eternal',    'Rainbow Eternal',      '100 rainbow games.',                                     'mythic',    '🌈', 100, 'border-rainbow-storm','title-rainbow-lord'),
  ('the-absolute',       'The Absolute',         'Undisputed #1 all-time. Admin-granted.',                 'mythic',    '🌟', 1,   'border-absolute',  'title-the-absolute')
ON CONFLICT (slug) DO NOTHING;
