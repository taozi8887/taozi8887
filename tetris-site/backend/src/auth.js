// ─── Authentication ───────────────────────────────────────────────
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me

const PBKDF2_ITER    = 250_000;
const SALT_BYTES     = 16;
const KEY_LEN_BYTES  = 32;
const JWT_EXPIRY_S   = 30 * 24 * 60 * 60; // 30 days

// ── PBKDF2 helpers ───────────────────────────────────────────────

function hexEncode(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr.buffer;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
    keyMaterial, KEY_LEN_BYTES * 8
  );
  return `${hexEncode(salt.buffer)}$${PBKDF2_ITER}$${hexEncode(bits)}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, iterStr, hashHex] = stored.split('$');
  const salt = new Uint8Array(hexDecode(saltHex));
  const iterations = parseInt(iterStr, 10);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial, KEY_LEN_BYTES * 8
  );
  // Constant-time comparison: sign both with a random ephemeral key and compare
  // signatures. This prevents timing attacks on the hex string equality.
  const cmpKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', cmpKey, new Uint8Array(bits)),
    crypto.subtle.sign('HMAC', cmpKey, new Uint8Array(hexDecode(hashHex))),
  ]);
  const a = new Uint8Array(sigA);
  const b = new Uint8Array(sigB);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── JWT (HMAC-SHA256, compact) ────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const b = atob(s);
  const arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  return arr.buffer;
}

async function signJWT(payload, secret) {
  const header  = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body    = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), new TextEncoder().encode(signingInput));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ── Rate limiting (KV sliding window) ────────────────────────────

async function rateLimit(env, key, maxRequests, windowSecs) {
  const kvKey = `rl:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await env.RATE_KV.get(kvKey, 'json');
  const hits = (raw || []).filter(t => t > now - windowSecs);
  if (hits.length >= maxRequests) return false;
  hits.push(now);
  await env.RATE_KV.put(kvKey, JSON.stringify(hits), { expirationTtl: windowSecs });
  return true;
}

// ── Shared: extract session from cookie ──────────────────────────

export async function getSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match  = cookie.match(/(?:^|;\s*)sess=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1], env.JWT_SECRET);
  if (!payload?.userId) return null;
  return payload;
}

// ── Helpers ──────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validateUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_\-]{3,20}$/.test(u);
}
function validateEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 100;
}
function validatePassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 128;
}

// ── Route handlers ────────────────────────────────────────────────

export async function handleRegister(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await rateLimit(env, `reg:${ip}`, 5, 3600);
  if (!allowed) return jsonResponse({ error: 'Too many requests. Try again later.' }, 429);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }

  const { username, email, password } = body || {};

  if (!validateUsername(username)) return jsonResponse({ error: 'Username must be 3–20 alphanumeric/underscore/dash characters.' }, 400);
  if (!validateEmail(email))        return jsonResponse({ error: 'Invalid email address.' }, 400);
  if (!validatePassword(password))  return jsonResponse({ error: 'Password must be 8–128 characters.' }, 400);

  // Check existing
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?1 OR email = ?2'
  ).bind(username, email.toLowerCase()).first();
  if (existing) return jsonResponse({ error: 'Username or email already taken.' }, 409);

  const id   = uuid();
  const hash = await hashPassword(password);
  const now  = Date.now();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, username, email, password_hash, elo, created_at, updated_at) VALUES (?1,?2,?3,?4,1000,?5,?5)'
    ).bind(id, username, email.toLowerCase(), hash, now),
    env.DB.prepare('INSERT INTO profiles (user_id) VALUES (?1)').bind(id),
    env.DB.prepare('INSERT INTO stats    (user_id) VALUES (?1)').bind(id),
  ]);

  const token = await signJWT(
    { userId: id, username, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + JWT_EXPIRY_S },
    env.JWT_SECRET
  );

  const isLocal = /localhost|127\.0\.0\.1/.test(request.headers.get('Origin') || request.url);
  const secureFlag = isLocal ? '' : '; Secure';

  return new Response(JSON.stringify({ ok: true, userId: id, username }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `sess=${token}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${JWT_EXPIRY_S}`,
    },
  });
}

export async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await rateLimit(env, `login:${ip}`, 10, 900); // 10 per 15 min
  if (!allowed) return jsonResponse({ error: 'Too many login attempts. Try again later.' }, 429);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400); }
  // Accept either `usernameOrEmail` (from the sign-in form) or legacy `username`
  const identifier = (body?.usernameOrEmail || body?.username || '').trim();
  const password   = body?.password || '';

  if (!identifier || !password) return jsonResponse({ error: 'Please fill in all fields.' }, 400);

  // Per-username rate limit: catches distributed (multi-IP) brute force on one account.
  // Runs before DB lookup so every attempt counts, not just failures.
  const userAllowed = await rateLimit(env, `login:user:${identifier.toLowerCase()}`, 20, 3600);
  if (!userAllowed) return jsonResponse({ error: 'Too many login attempts for this account. Try again later.' }, 429);

  // Look up by username OR email
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash FROM users WHERE username = ?1 OR email = ?2'
  ).bind(identifier, identifier.toLowerCase()).first();

  // Always run verifyPassword to prevent timing attacks even if user not found
  // Dummy must match real format exactly: 32-hex salt + iterations + 64-hex hash
  const dummyHash = '00000000000000000000000000000000$250000$0000000000000000000000000000000000000000000000000000000000000000';
  const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, dummyHash);
  if (!user || !ok) return jsonResponse({ error: 'Invalid username or password.' }, 401);

  const now   = Date.now();
  const token = await signJWT(
    { userId: user.id, username: user.username, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + JWT_EXPIRY_S },
    env.JWT_SECRET
  );

  const isLocal = /localhost|127\.0\.0\.1/.test(request.headers.get('Origin') || request.url);
  const secureFlag = isLocal ? '' : '; Secure';

  return new Response(JSON.stringify({ ok: true, userId: user.id, username: user.username }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `sess=${token}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${JWT_EXPIRY_S}`,
    },
  });
}

export async function handleLogout(_request, _env) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'sess=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    },
  });
}

export async function handleMe(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.elo, u.xp, u.created_at,
            p.bio, p.avatar_key, p.country, p.display_name,
            s.games_played, s.games_won, s.total_lines, s.best_score,
            s.versus_won, s.sprint_won, s.coop_won
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN stats s    ON s.user_id = u.id
     WHERE u.id = ?1`
  ).bind(session.userId).first();

  if (!row) return jsonResponse({ error: 'User not found.' }, 404);

  const avatarUrl = row.avatar_key
    ? `/api/profile/avatar/${row.avatar_key}`
    : null;

  // Explicit allowlist - never spread DB rows directly to avoid future column leaks
  return jsonResponse({
    id:           row.id,
    username:     row.username,
    elo:          row.elo,
    xp:           row.xp || 0,
    created_at:   row.created_at,
    bio:          row.bio,
    country:      row.country,
    display_name: row.display_name,
    avatarUrl,
    stats: {
      games_played: row.games_played,
      games_won:    row.games_won,
      total_lines:  row.total_lines,
      best_score:   row.best_score,
      versus_won:   row.versus_won,
      sprint_won:   row.sprint_won,
      coop_won:     row.coop_won,
    },
  });
}
