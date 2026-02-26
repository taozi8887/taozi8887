//  Profile 
// GET  /api/profile/settings        own settings blob      (BEFORE /:username)
// PUT  /api/profile/settings        save settings blob
// POST /api/profile/avatar          upload avatar (multipart)
// GET  /api/profile                 own profile (requires auth)
// GET  /api/profile/:username       public profile (auth optional)
// PUT  /api/profile                 update own profile

import { Router }  from 'express';
import multer       from 'multer';
import { supabase } from './index.js';
import { requireAuth, optionalAuth, requireEmailVerified } from './auth.js';
import { getRank }   from './elo.js';
import { activegame } from './index.js';

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2 MB – Supabase bucket enforces its own cap

const runUpload = (req, res) => new Promise((resolve, reject) => {
  upload.single('avatar')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') reject(Object.assign(new Error('File too large. Maximum avatar size is 512 KB.'), { isLimit: true }));
    else if (err) reject(err);
    else resolve();
  });
});
const AVATAR_BUCKET = 'avatars';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Ensure the avatar storage bucket exists.
 * Call once at server startup – not on every upload.
 * Safe to call even if the bucket already exists (ignores the "already exists" error).
 * If the service role key is misconfigured this will log a clear warning once,
 * rather than noisy per-request errors.
 */
export async function initAvatarBucket() {
  const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024, // 2 MB
    allowedMimeTypes: [...ALLOWED_TYPES],
  });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    if (error.statusCode === '403' || error.status === 400) {
      console.warn(
        `[storage] Cannot create "${AVATAR_BUCKET}" bucket — RLS or permissions issue.\n` +
        `  → Create the bucket manually in the Supabase dashboard (Storage → New bucket → "${AVATAR_BUCKET}", Public ✔).\n` +
        `  → Or check that SUPABASE_SERVICE_ROLE_KEY is set correctly in production.`,
      );
    } else {
      console.error('[storage] initAvatarBucket error:', error);
    }
  }
}

//  GET /api/profile/settings 
// IMPORTANT: declared BEFORE /:username so Express matches it first
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('profiles').select('settings').eq('user_id', req.user.id).single();
    let settings = {};
    try { settings = JSON.parse(data?.settings || '{}'); } catch {}
    res.json({ settings });
  } catch (err) {
    console.error('GET /api/profile/settings:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  PUT /api/profile/settings 
router.put('/settings', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { settings } = req.body || {};
    if (typeof settings !== 'object' || settings === null)
      return res.status(400).json({ error: 'settings must be an object.' });
    const json = JSON.stringify(settings);
    if (json.length > 8000) return res.status(400).json({ error: 'Settings too large.' });
    await supabase.from('profiles').upsert({ user_id: req.user.id, settings: json, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/profile/settings:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/profile/avatar 
router.post('/avatar', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    await runUpload(req, res);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!ALLOWED_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Only JPEG, PNG, WebP or GIF images allowed.' });
  } catch (err) {
    if (err.isLimit) return res.status(400).json({ error: err.message });
    console.error('POST /api/profile/avatar upload middleware:', err);
    return res.status(500).json({ error: 'Upload failed.' });
  }
  try {

    const userId = req.user.id;
    const ext    = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const key    = `${userId}-${Date.now()}.${ext}`;

    // Delete old avatar if exists
    const { data: prof } = await supabase.from('profiles').select('avatar_url').eq('user_id', userId).single();
    if (prof?.avatar_url) {
      const pathMatch = prof.avatar_url.match(/avatars\/(.+)$/);
      if (pathMatch) await supabase.storage.from(AVATAR_BUCKET).remove([pathMatch[1]]).catch(() => {});
    }

    const { error: uploadErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(key, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadErr) {
      const isRlsError = uploadErr.statusCode === '403'
        || (uploadErr.status === 400 && uploadErr.message?.toLowerCase().includes('security policy'));
      if (isRlsError) {
        console.error(
          'POST /api/profile/avatar: Storage upload blocked by RLS.\n' +
          '  → Ensure the "avatars" bucket exists and SUPABASE_SERVICE_ROLE_KEY is set correctly.\n' +
          '  → In Supabase dashboard: Storage → avatars bucket → Policies → allow service_role INSERT.',
          uploadErr,
        );
        return res.status(503).json({ error: 'Avatar storage is not configured. Please contact the administrator.' });
      }
      throw uploadErr;
    }

    const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(key);
    const avatarUrl = urlData.publicUrl;

    await supabase.from('profiles').upsert({ user_id: userId, avatar_url: avatarUrl, updated_at: new Date().toISOString() });
    res.json({ ok: true, avatarUrl });
  } catch (err) {
    console.error('POST /api/profile/avatar:', err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

//  GET /api/profile (own profile) 
router.get('/', requireAuth, async (req, res) => {
  return getProfileByUsername(req.user.username, res, req.user.id);
});

//  GET /api/profile/:username 
router.get('/:username', optionalAuth, async (req, res) => {
  return getProfileByUsername(req.params.username, res, req.user?.id);
});

//  PUT /api/profile (update own profile) 
router.put('/', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bio, country, display_name } = req.body || {};

    const profileUpdates = {};
    if (bio     !== undefined) profileUpdates.bio     = String(bio).slice(0, 200);
    if (country !== undefined) profileUpdates.country = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : '';

    const userUpdates = {};
    if (display_name !== undefined) userUpdates.display_name = String(display_name).slice(0, 30);

    if (Object.keys(userUpdates).length) {
      userUpdates.updated_at = new Date().toISOString();
      await supabase.from('users').update(userUpdates).eq('id', userId);
    }
    if (Object.keys(profileUpdates).length) {
      profileUpdates.updated_at = new Date().toISOString();
      await supabase.from('profiles').upsert({ user_id: userId, ...profileUpdates });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/profile:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  Shared helper 
async function getProfileByUsername(username, res, requestorId) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id, username, display_name, elo, xp, created_at,
        profiles ( bio, avatar_url, country, equipped_border, equipped_title ),
        stats ( * )
      `)
      .eq('username', username)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found.' });

    const rank     = getRank(user.elo);
    const statsRaw = user.stats || {};

    const { data: matchRows } = await supabase
      .from('matches')
      .select(`
        id, mode, room_code, is_ranked, void_reason,
        p1_id, p2_id, winner_id,
        p1_score, p2_score, p1_lines, p2_lines,
        p1_elo_delta, p2_elo_delta, duration_ms, played_at,
        p1_final_board, p2_final_board,
        p1:p1_id ( username, display_name, elo, xp ),
        p2:p2_id ( username, display_name, elo, xp )
      `)
      .or(`p1_id.eq.${user.id},p2_id.eq.${user.id}`)
      .order('played_at', { ascending: false })
      .limit(20);

    // Flatten nested p1/p2 join so frontend reads m.p1_name, m.p1_display, m.p1_elo etc.
    const recent_matches = (matchRows || []).map(m => ({
      ...m,
      p1_name:    m.p1?.username     || null,
      p1_display: m.p1?.display_name || null,
      p1_elo:     m.p1?.elo          ?? null,
      p1_xp:      m.p1?.xp           ?? 0,
      p2_name:    m.p2?.username     || null,
      p2_display: m.p2?.display_name || null,
      p2_elo:     m.p2?.elo          ?? null,
      p2_xp:      m.p2?.xp           ?? 0,
    }));

    // Batch-fetch profiles + equipped title cosmetics for all players in these matches
    const allPlayerIds = [...new Set(recent_matches.flatMap(m => [m.p1_id, m.p2_id].filter(Boolean)))];
    if (allPlayerIds.length) {
      const { data: matchProfs } = await supabase
        .from('profiles')
        .select('user_id, avatar_url, equipped_title')
        .in('user_id', allPlayerIds);
      const matchProfMap = {};
      for (const p of matchProfs || []) matchProfMap[p.user_id] = p;

      const titleSlugs = [...new Set(Object.values(matchProfMap).map(p => p.equipped_title).filter(Boolean))];
      const matchTitleMap = {};
      if (titleSlugs.length) {
        const { data: titleCos } = await supabase
          .from('cosmetics')
          .select('slug, name, icon, rarity')
          .in('slug', titleSlugs);
        for (const c of titleCos || []) matchTitleMap[c.slug] = c;
      }

      for (const m of recent_matches) {
        const pp1 = matchProfMap[m.p1_id];
        const pp2 = matchProfMap[m.p2_id];
        m.p1_avatar = pp1?.avatar_url || null;
        m.p2_avatar = pp2?.avatar_url || null;
        m.p1_title  = pp1?.equipped_title ? (matchTitleMap[pp1.equipped_title] || null) : null;
        m.p2_title  = pp2?.equipped_title ? (matchTitleMap[pp2.equipped_title] || null) : null;
      }
    }

    const liveRoomCode = activegame.get(user.id) || null;

    // Achievement count
    const { count: achEarned } = await supabase
      .from('user_achievements')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('earned', true);

    // Fetch full cosmetic objects for equipped items
    const equippedSlugs = [
      user.profiles?.equipped_border,
      user.profiles?.equipped_title,
    ].filter(Boolean);
    const equippedCosMap = {};
    if (equippedSlugs.length) {
      let { data: cosRows } = await supabase
        .from('cosmetics')
        .select('slug, type, name, rarity, icon, description')
        .in('slug', equippedSlugs);
      // Retry once — on cold server start the Supabase connection pool may not
      // be ready yet and the query silently returns null/[] on the first call.
      if (!cosRows?.length) {
        await new Promise(r => setTimeout(r, 400));
        ({ data: cosRows } = await supabase
          .from('cosmetics')
          .select('slug, type, name, rarity, icon, description')
          .in('slug', equippedSlugs));
      }
      for (const c of cosRows || []) equippedCosMap[c.slug] = c;
    }

    // Flat structure — frontend reads these at the top level
    res.json({
      id:           user.id,
      username:     user.username,
      display_name: user.display_name || '',
      elo:          user.elo,
      xp:           user.xp || 0,
      created_at:   user.created_at,
      bio:          user.profiles?.bio        || '',
      country:      user.profiles?.country    || '',
      avatarUrl:    user.profiles?.avatar_url || null,
      equippedBorder: user.profiles?.equipped_border
        ? (equippedCosMap[user.profiles.equipped_border] || { slug: user.profiles.equipped_border })
        : null,
      equippedTitle: user.profiles?.equipped_title
        ? (equippedCosMap[user.profiles.equipped_title] || { slug: user.profiles.equipped_title })
        : null,
      rank:         rank.name,
      rank_color:   rank.color,
      liveRoomCode,
      isOwnProfile: requestorId === user.id,
      stats:         statsRaw,
      recent_matches: recent_matches,
      achievements_earned: achEarned ?? 0,
    });
  } catch (err) {
    console.error('getProfileByUsername:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}
