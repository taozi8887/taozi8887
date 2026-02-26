-- ── 004: Add Grandmaster rank cosmetics + achievement ──

-- Border + Title
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('border-grandmaster',       'border', 'Grandmaster',        'legendary', 'Dual-spinning crown ring of violet flame and molten gold.', '👑'),
  ('title-grandmaster-gambit', 'title',  'Grandmaster Gambit', 'legendary', NULL, '👑')
ON CONFLICT (slug) DO NOTHING;

-- Achievement
INSERT INTO public.achievements (slug, name, description, rarity, icon, progress_total, reward_border_slug, reward_title_slug) VALUES
  ('grandmaster-gambit', 'Grandmaster Gambit', 'Reach Grandmaster rank on the ranked ladder.', 'legendary', '👑', 1, 'border-grandmaster', 'title-grandmaster-gambit')
ON CONFLICT (slug) DO NOTHING;
