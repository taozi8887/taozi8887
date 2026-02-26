-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 005: Special / Staff Titles                       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── 1. Extend rarity check constraint to allow 'special' ───────
ALTER TABLE public.cosmetics
  DROP CONSTRAINT IF EXISTS cosmetics_rarity_check;

ALTER TABLE public.cosmetics
  ADD CONSTRAINT cosmetics_rarity_check
  CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic','special'));

-- ── 2. Insert special staff titles ─────────────────────────────
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('title-dev',  'title', 'Developer', 'special', 'Built this. 🛠', '🛠'),
  ('title-mod',  'title', 'Moderator', 'special', 'Keeps it clean. 🛡', '🛡')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Grant both titles to oneaboveall ────────────────────────
INSERT INTO public.user_cosmetics (user_id, cosmetic_slug)
SELECT id, 'title-dev' FROM public.users WHERE username = 'oneaboveall'
ON CONFLICT (user_id, cosmetic_slug) DO NOTHING;

INSERT INTO public.user_cosmetics (user_id, cosmetic_slug)
SELECT id, 'title-mod' FROM public.users WHERE username = 'oneaboveall'
ON CONFLICT (user_id, cosmetic_slug) DO NOTHING;
