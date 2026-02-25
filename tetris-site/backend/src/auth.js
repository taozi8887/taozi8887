//  Authentication 
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me
// Middleware: requireAuth, optionalAuth

import { Router }       from 'express';
import { supabase }     from './index.js';
import { getRank }      from './elo.js';

export const router = Router();

const JWT_EXPIRY_S  = 30 * 24 * 60 * 60; // 30 days
const SITE_URL      = process.env.SITE_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5500';

function validateUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9_\-]{3,20}$/.test(u); }
function validateEmail(e)    { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 100; }
function validatePassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 128; }

function setCookie(res, req, token) {
  const isLocal = /localhost|127\.0\.0\.1/.test(req.headers.origin || req.headers.referer || '');
  res.cookie('sess', token, {
    httpOnly:  true,
    secure:    !isLocal,
    sameSite:  'lax',
    maxAge:    JWT_EXPIRY_S * 1000,
    path:      '/',
  });
}

//  POST /api/auth/register 
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!validateUsername(username)) return res.status(400).json({ error: 'Username must be 3–20 alphanumeric / underscore / dash characters.' });
    if (!validateEmail(email))       return res.status(400).json({ error: 'Invalid email address.' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 8–128 characters.' });

    // Check username uniqueness
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Username already taken.' });

    // Use signUp (not admin.createUser) so Supabase sends the verification email via SMTP
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/verify.html`,
      },
    });
    if (authErr) {
      if (authErr.message?.includes('already registered')) return res.status(409).json({ error: 'Email already registered.' });
      return res.status(400).json({ error: authErr.message || 'Registration failed.' });
    }

    // signUp with an existing unconfirmed email returns a fake user with no ID — treat as duplicate
    const userId = authData?.user?.id;
    if (!userId) return res.status(409).json({ error: 'Email already registered.' });

    // signUp with an existing confirmed email: identities array is empty
    if (authData?.user?.identities?.length === 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Insert public.users record using admin client
    const { error: insertErr } = await supabase.from('users').insert({
      id:           userId,
      username,
      display_name: '',
      elo:          1000,
      xp:           0,
    });
    if (insertErr) {
      // Cleanup auth user if insert failed
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      console.error('[register] insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to create user record.' });
    }

    // Verification email has been sent — don't create a session yet
    res.status(201).json({ ok: true, userId, username, needsVerification: true });
  } catch (err) {
    console.error('[register] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  POST /api/auth/session 
// Called by verify.html after the Supabase email-confirmation redirect.
// Client passes the access_token from the URL hash so the server can set the cookie.
router.post('/session', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token required.' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token.' });
    if (!data.user.email_confirmed_at) return res.status(403).json({ error: 'Email not yet verified. Please check your inbox.' });

    const { data: profile } = await supabase
      .from('users').select('id, username').eq('id', data.user.id).single();
    setCookie(res, req, token);
    res.json({ ok: true, userId: data.user.id, username: profile?.username || data.user.email });
  } catch (err) {
    console.error('[session] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  POST /api/auth/login 
router.post('/login', async (req, res) => {
  try {
  const identifier = (req.body?.usernameOrEmail || req.body?.username || '').trim();
  const password   = req.body?.password || '';
  if (!identifier || !password) return res.status(400).json({ error: 'Please fill in all fields.' });

  // Resolve identifier: could be username or email
  let email = identifier;
  if (!identifier.includes('@')) {
    const { data: u } = await supabase
      .from('users')
      .select('id')
      .eq('username', identifier)
      .single();
    if (!u) return res.status(401).json({ error: 'Invalid username or password.' });
    // Get email from auth.users via admin API
    const { data: authUser } = await supabase.auth.admin.getUserById(u.id);
    if (!authUser?.user?.email) return res.status(401).json({ error: 'Invalid username or password.' });
    email = authUser.user.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return res.status(401).json({ error: 'Invalid username or password.' });

  const { data: profile } = await supabase.from('users').select('id, username').eq('id', data.user.id).single();
  setCookie(res, req, data.session.access_token);
  res.json({ ok: true, userId: data.user.id, username: profile?.username || data.user.email });
  } catch (err) {
    console.error('[login] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  POST /api/auth/logout 
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.sess;
    if (token) {
      await supabase.auth.admin.signOut(token).catch(() => {});
    }
    res.clearCookie('sess', { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[logout] unhandled error:', err);
    res.clearCookie('sess', { path: '/' });
    res.json({ ok: true });
  }
});

//  GET /api/auth/me 
router.get('/me', async (req, res) => {
  try {
  const token = req.cookies?.sess;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  const userId = data.user.id;

  const { data: row } = await supabase
    .from('users')
    .select(`
      id, username, display_name, elo, xp, created_at,
      profiles ( bio, avatar_url, country, settings ),
      stats ( games_played, games_won, total_lines, best_score, versus_won, sprint_won, coop_won )
    `)
    .eq('id', userId)
    .single();

  if (!row) return res.status(404).json({ error: 'User not found.' });

  const rank     = getRank(row.elo);
  const statsRow = row.stats || {};

  res.json({
    id:           row.id,
    username:     row.username,
    display_name: row.display_name || '',
    elo:          row.elo,
    xp:           row.xp || 0,
    created_at:   row.created_at,
    bio:          row.profiles?.bio     || '',
    country:      row.profiles?.country || '',
    avatarUrl:    row.profiles?.avatar_url || null,
    rank:          rank.name,
    emailVerified: !!data.user.email_confirmed_at,
    stats: {
      games_played: statsRow.games_played || 0,
      games_won:    statsRow.games_won    || 0,
      total_lines:  statsRow.total_lines  || 0,
      best_score:   statsRow.best_score   || 0,
      versus_won:   statsRow.versus_won   || 0,
      sprint_won:   statsRow.sprint_won   || 0,
      coop_won:     statsRow.coop_won     || 0,
    },
  });
  } catch (err) {
    console.error('[me] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  Middleware 
export async function requireAuth(req, res, next) {
  const token = req.cookies?.sess || (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await supabase
    .from('users').select('id, username, display_name, elo, xp').eq('id', data.user.id).single();
  req.user = { ...data.user, ...profile, emailVerified: !!data.user.email_confirmed_at };
  next();
}

export function requireEmailVerified(req, res, next) {
  if (!req.user?.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address before using this feature.' });
  }
  next();
}

export async function optionalAuth(req, _res, next) {
  const token = req.cookies?.sess || (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) {
      const { data: profile } = await supabase
        .from('users').select('id, username, display_name, elo, xp').eq('id', data.user.id).single();
      req.user = { ...data.user, ...profile };
    }
  }
  next();
}
