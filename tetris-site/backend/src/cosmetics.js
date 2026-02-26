import { Router } from 'express';
import { requireAuth } from './auth.js';
import { supabase } from './index.js';

export const router = Router();

// ── GET /api/cosmetics ─────────────────────────────────────────────────────
// Returns all cosmetics + all achievements (no auth required).
// Owned state is resolved client-side via GET /api/cosmetics/me.
router.get('/', async (req, res) => {

  // Fetch catalogues in parallel, with one retry on cold-start empty results
  async function fetchCatalogues() {
    const [c, a] = await Promise.all([
      supabase.from('cosmetics').select('*').order('type').order('rarity').order('name'),
      supabase.from('achievements').select('*').order('rarity').order('name'),
    ]);
    if (c.error || a.error) {
      console.error('[cosmetics] catalogue query errors:', c.error?.message, a.error?.message);
      return null;
    }
    console.log(`[cosmetics] catalogue fetched: ${c.data?.length ?? 'null'} cosmetics, ${a.data?.length ?? 'null'} achievements`);
    return { cosmetics: c.data, achievements: a.data };
  }

  let result = await fetchCatalogues();
  if (!result || (!result.cosmetics?.length && !result.achievements?.length)) {
    console.warn('[cosmetics] first fetch empty/null, retrying in 500ms…');
    await new Promise(r => setTimeout(r, 500));
    result = await fetchCatalogues();
  }

  if (!result) return res.status(500).json({ error: 'Failed to load cosmetics.' });
  if (!result.cosmetics?.length && !result.achievements?.length) {
    console.error('[cosmetics] catalogue still empty after retry — returning 503');
    return res.status(503).json({ error: 'Catalogue temporarily unavailable.' });
  }

  res.json({ cosmetics: result.cosmetics, achievements: result.achievements });
});

// ── GET /api/cosmetics/me ──────────────────────────────────────────────────
// Returns the authenticated user's inventory + equipped selections.
router.get('/me', requireAuth, async (req, res) => {
  const userId   = req.user.id;

  const [
    { data: inventory, error: e1 },
    { data: profile,   error: e2 },
    { data: achProgress, error: e3 },
  ] = await Promise.all([
    supabase
      .from('user_cosmetics')
      .select('cosmetic_slug, unlocked_at, cosmetics(slug, type, name, rarity, description, icon)')
      .eq('user_id', userId),
    supabase
      .from('profiles')
      .select('equipped_border, equipped_title')
      .eq('user_id', userId)
      .maybeSingle(),   // null (not error) when profile row doesn't exist yet
    supabase
      .from('user_achievements')
      .select('achievement_slug, progress, earned, earned_at')
      .eq('user_id', userId),
  ]);

  if (e1 || e2 || e3) return res.status(500).json({ error: 'Failed to load inventory.' });

  res.json({
    inventory: (inventory ?? []).map(r => ({
      ...r.cosmetics,
      unlocked_at: r.unlocked_at,
    })),
    equipped: {
      border: profile?.equipped_border ?? null,
      title:  profile?.equipped_title  ?? null,
    },
    achievements: achProgress ?? [],
  });
});

// ── PUT /api/cosmetics/equip ───────────────────────────────────────────────
// Body: { type: 'border' | 'title', slug: string }
// Sets equipped_border or equipped_title on the user's profile.
router.put('/equip', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const { type, slug } = req.body ?? {};

  if (!type || !slug) {
    return res.status(400).json({ error: 'type and slug are required.' });
  }
  if (type !== 'border' && type !== 'title') {
    return res.status(400).json({ error: 'type must be border or title.' });
  }

  // Verify user owns the item (unless equipping the default border which everyone has)
  if (slug !== 'border-default') {
    const { data: owned } = await supabase
      .from('user_cosmetics')
      .select('cosmetic_slug')
      .eq('user_id', userId)
      .eq('cosmetic_slug', slug)
      .maybeSingle();

    if (!owned) {
      return res.status(403).json({ error: 'You do not own that cosmetic.' });
    }
  }

  const column = type === 'border' ? 'equipped_border' : 'equipped_title';

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, [column]: slug }, { onConflict: 'user_id' });

  if (error) return res.status(500).json({ error: 'Failed to equip cosmetic.' });

  res.json({ ok: true, equipped: { type, slug } });
});

// ── PUT /api/cosmetics/unequip ─────────────────────────────────────────────
// Body: { type: 'border' | 'title' }
router.put('/unequip', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const { type } = req.body ?? {};

  if (type !== 'border' && type !== 'title') {
    return res.status(400).json({ error: 'type must be border or title.' });
  }

  const column = type === 'border' ? 'equipped_border' : 'equipped_title';

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, [column]: null }, { onConflict: 'user_id' });

  if (error) return res.status(500).json({ error: 'Failed to unequip.' });

  res.json({ ok: true });
});
