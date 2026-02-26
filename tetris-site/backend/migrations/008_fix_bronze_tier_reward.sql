-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 008: Fix bronze-tier achievement missing border reward    ║
-- ║  Run once in Supabase SQL Editor.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Every other rank-tier achievement gives its corresponding border cosmetic:
--   silver-lining      → border-silver
--   gold-rush          → border-gold
--   platinum-peak      → border-platinum
--   diamond-status     → border-diamond
--   masters-degree     → border-master
--   grandmaster-gambit → border-grandmaster
--   tetris-king        → border-challenger
--
-- The bronze-tier achievement (reach 1,050 ELO) was seeded with NULL border
-- reward in migration 006 — that omission is fixed here.

UPDATE public.achievements
SET reward_border_slug = 'border-bronze'
WHERE slug = 'bronze-tier'
  AND reward_border_slug IS NULL;
