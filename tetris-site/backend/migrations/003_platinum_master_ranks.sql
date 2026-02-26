-- ── 003: Add Platinum and Master rank cosmetics + achievements ──

-- Borders
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('border-platinum', 'border', 'Platinum', 'rare',      'Sweeping silver-blue arc shimmer.', '🪙'),
  ('border-master',   'border', 'Master',   'epic',      'Dual crimson-violet spinning crown ring.', '🔮')
ON CONFLICT (slug) DO NOTHING;

-- Titles
INSERT INTO public.cosmetics (slug, type, name, rarity, description, icon) VALUES
  ('title-platinum-peak', 'title', 'Platinum Peak', 'rare', NULL, '🪙'),
  ('title-master-class',  'title', 'Master Class',  'epic', NULL, '🔮')
ON CONFLICT (slug) DO NOTHING;

-- Achievements
INSERT INTO public.achievements (slug, name, description, rarity, icon, progress_total, reward_border_slug, reward_title_slug) VALUES
  ('platinum-peak',  'Platinum Peak',   'Reach Platinum rank on the ranked ladder.', 'rare', '🪙', 1, 'border-platinum', 'title-platinum-peak'),
  ('masters-degree', 'Master''s Degree', 'Reach Master rank on the ranked ladder.',  'epic', '🔮', 1, 'border-master',   'title-master-class')
ON CONFLICT (slug) DO NOTHING;
