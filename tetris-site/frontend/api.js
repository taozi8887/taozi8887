/**
 * api.js - lightweight typed wrapper around the tetris-site REST API.
 *
 * All requests are sent with credentials: 'include' so the HttpOnly JWT
 * cookie is forwarded automatically.
 *
 * Usage:
 *   import API from './api.js';
 *   const me = await API.auth.me();
 *   const lb = await API.leaderboard.get({ page: 1 });
 */

const BASE = (() => {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    return `http://${location.hostname}:8787`;
  return 'https://api.tetris.taozi4887.dev';
})();

/* ── Core fetch helper ────────────────────────────────────────── */

async function req(method, path, { body, params } = {}) {
  let url = BASE + path;
  if (params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v]) => v != null))
    );
    if ([...qs].length) url += '?' + qs.toString();
  }
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  };
  if (body !== undefined) {
    opts.body    = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, opts);
  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  else                                 data = await res.text();
  if (!res.ok) {
    const msg = (typeof data === 'object' && data?.error) ? data.error : String(data);
    throw Object.assign(new Error(msg || `HTTP ${res.status}`), { status: res.status, body: data });
  }
  return data;
}

async function upload(path, formData) {
  const res = await fetch(BASE + path, {
    method: 'POST', credentials: 'include', body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, body: data });
  return data;
}

/* ── Auth ─────────────────────────────────────────────────────── */

const auth = {
  /** Register a new account. { username, email, password } → user */
  register: (body) => req('POST', '/api/auth/register', { body }),

  /** Login. { usernameOrEmail, password } → user */
  login:    (body) => req('POST', '/api/auth/login', { body }),

  /** Logout (clears cookie). */
  logout:   ()     => req('POST', '/api/auth/logout'),

  /** Fetch the currently logged-in user (or throws 401). */
  me:       ()     => req('GET',  '/api/auth/me'),
};

/* ── Profile ──────────────────────────────────────────────────── */

const profile = {
  /** Get own profile (auth required). */
  get:       ()           => req('GET',  '/api/profile'),

  /** Get a public profile by username. */
  getByName: (username)   => req('GET',  `/api/profile/${encodeURIComponent(username)}`),

  /** Update own profile. { bio?, country?, display_name? } */
  update:    (body)       => req('PUT',  '/api/profile', { body }),

  /** Upload avatar. Expects a FormData with field 'avatar'. */
  uploadAvatar: (fd)      => upload('/api/profile/avatar', fd),

  /** Resolve avatar image URL from key (returns absolute URL). */
  avatarUrl: (key) => key ? `${BASE}/api/profile/avatar/${encodeURIComponent(key)}` : null,

  /** Fetch own game settings from DB. Returns { settings } */
  getSettings:  ()      => req('GET', '/api/profile/settings'),

  /** Persist own game settings to DB. { settings: {...} } */
  saveSettings: (body)  => req('PUT', '/api/profile/settings', { body }),
};

/* ── Leaderboard ──────────────────────────────────────────────── */

const leaderboard = {
  /** { page?, limit? } → { players: [...], total, page, hasMore } */
  get: (params) => req('GET', '/api/leaderboard', { params }),
};

/* ── Friends ──────────────────────────────────────────────────── */

const friends = {
  /** Get own friends list + pending requests. */
  list:    ()           => req('GET',  '/api/friends'),

  /** Send a friend request. { username } */
  request: (body)       => req('POST', '/api/friends/request', { body }),

  /** Respond to a friend request. { id: friendshipRowId, action: 'accept'|'decline' } */
  respond: (body)       => req('POST', '/api/friends/respond', { body }),

  /** Remove an accepted friend. */
  remove:  (userId)     => req('DELETE', `/api/friends/${encodeURIComponent(userId)}`),
};

/* ── Inbox (challenge system) ─────────────────────────────────── */

const inbox = {
  /** Get pending challenges for the current user. */
  list:    ()     => req('GET',  '/api/inbox'),

  /**
   * Send a challenge to a friend.
   * { username, mode: 'versus'|'sprint'|'coop', room_code, message? }
   * Generate room_code with: Math.random().toString(36).slice(2,8).toUpperCase()
   */
  challenge: (body) => req('POST', '/api/inbox/challenge', { body }),

  /**
   * Respond to a challenge.
   * { id: challengeRowId, action: 'accept'|'decline' }
   * Returns { room_code, mode } on accept.
   */
  respond: ({ challengeId, id, action }) =>
    req('POST', '/api/inbox/respond', { body: { id: id ?? challengeId, action } }),
};

/* ── Stats ───────────────────────────────────────────────────── */

const stats = {
  /** Record a completed solo game. { score, lines, timeMs } */
  recordSolo: (body) => req('POST', '/api/stats/solo', { body }),

  /** Get aggregate global stats (homepage banner). */
  global: () => req('GET', '/api/stats/global'),
};

/* ── Matchmaking ─────────────────────────────────────────────── */

const matchmaking = {
  /**
   * Open a WebSocket connection to the matchmaking queue.
   * mode: 'ranked-versus' | 'casual-versus'
   * Returns the raw WebSocket. The caller is responsible for:
   *   1. Sending { type:'enqueue', ...userData } on open
   *   2. Handling { type:'matchFound' } to navigate to game
   *   3. Sending { type:'leave' } or ws.close() to exit queue
   */
  connect(mode) {
    const wsBase = BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsBase}/matchmaking/${mode}`);
  },
};

/* ── Misc ─────────────────────────────────────────────────────── */

const health = {
  check: () => req('GET', '/health'),
};

/* ── Exported API object ──────────────────────────────────────── */

const API = { auth, profile, leaderboard, stats, friends, inbox, matchmaking, health, BASE };
export default API;

/* ── Helpers exposed as named exports ─────────────────────────── */

/**
 * Try to fetch the currently-authed user.
 * Returns null (not throws) on 401/network error.
 */
export async function getMe() {
  try { return await auth.me(); }
  catch { return null; }
}

/**
 * Inject current user info into the navbar.
 * Expects elements with ids: navUsername, navAvatar, navLoginBtn, navLogoutBtn.
 */
export async function injectNavUser(me) {
  if (!me) me = await getMe();
  const loginBtn  = document.getElementById('navLoginBtn');
  const logoutBtn = document.getElementById('navLogoutBtn');
  const username  = document.getElementById('navUsername');
  const avatar    = document.getElementById('navAvatar');
  const friendsLink = document.getElementById('navFriendsLink');
  if (!me) {
    loginBtn?.classList.remove('hidden');
    logoutBtn?.classList.add('hidden');
    username?.classList.add('hidden');
    if (avatar) avatar.style.display = 'none';
    if (friendsLink) friendsLink.style.display = 'none';
    document.getElementById('navSettingsBtn')?.classList.add('hidden');
    return null;
  }
  loginBtn?.classList.add('hidden');
  logoutBtn?.classList.remove('hidden');
  if (friendsLink) friendsLink.style.display = '';
  // Show username to the left of avatar
  if (username) {
    username.textContent = me.username;
    username.classList.remove('hidden');
  }
  // Show settings button if present
  const settingsBtn = document.getElementById('navSettingsBtn');
  if (settingsBtn) settingsBtn.classList.remove('hidden');
  // Update avatar link to point to own profile
  const avatarLink = document.getElementById('navAvatarLink');
  if (avatarLink) avatarLink.href = 'profile.html';
  if (avatar) {
    // handleMe returns avatarUrl as a relative path or full URL
    const rawUrl = me.avatarUrl || me.profile?.avatar_key
      ? (me.avatarUrl || API.profile.avatarUrl(me.profile?.avatar_key))
      : '';
    const src = rawUrl
      ? (rawUrl.startsWith('http') ? rawUrl : BASE + rawUrl)
      : '';
    avatar.style.display = '';
    if (avatar.tagName === 'IMG') {
      avatar.src = src;
    } else {
      if (src) {
        avatar.innerHTML = `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">`;
      } else {
        avatar.textContent = (me.username || '?').slice(0, 2).toUpperCase();
      }
    }
  }
  // Update friend notification badge (pending friend requests + pending challenges)
  try {
    const badgeEl = document.getElementById('navFriendsBadge');
    if (badgeEl) {
      const [fd, inboxData] = await Promise.all([friends.list(), inbox.list().catch(() => ({ challenges: [] }))]);
      const incomingRequests  = (fd.friends || []).filter(f => f.status === 'pending' && !f.isSent).length;
      const pendingChallenges = (inboxData.challenges || []).length;
      const total = incomingRequests + pendingChallenges;
      if (total > 0) {
        badgeEl.textContent = total > 9 ? '9+' : total;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  } catch {}
  // Start challenge polling to show popup when challenged
  startChallengePolling(me);
  return me;
}

/**
 * Poll for new challenge invites and show a popup when a new one arrives.
 * Safe to call multiple times - sets up only one interval.
 */
let _challengePollInterval = null;
export function startChallengePolling(me) {
  if (_challengePollInterval) return;  // already polling
  const storageKey       = 'seenChallengeIds';
  const activeKey        = 'activeChallengeMap'; // id -> { name, mode }
  const getSeenIds       = () => new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  const saveSeenIds      = (set) => localStorage.setItem(storageKey, JSON.stringify([...set]));
  const getActiveMap     = () => { try { return JSON.parse(localStorage.getItem(activeKey) || '{}'); } catch { return {}; } };
  const saveActiveMap    = (m)  => localStorage.setItem(activeKey, JSON.stringify(m));

  const checkChallenges = async () => {
    // Don't show popup while actively in a multiplayer game
    if (document.body?.classList.contains('mp')) return;
    try {
      const data = await inbox.list();
      const challenges = data.challenges || [];
      const seen   = getSeenIds();
      const active = getActiveMap();
      const currentIds = new Set(challenges.map(c => String(c.id)));

      // Detect cancelled challenges (were active, now gone from inbox)
      for (const [id, info] of Object.entries(active)) {
        if (!currentIds.has(id)) {
          // Dismiss the live Accept/Decline toast for this challenge, if still open
          const acceptBtn = document.getElementById(`cp-accept-${id}`);
          if (acceptBtn) {
            const oldToast = acceptBtn.closest('.toast');
            if (oldToast) {
              oldToast.style.opacity = '0'; oldToast.style.transition = 'opacity .3s';
              setTimeout(() => oldToast.remove(), 300);
            }
          }
          // Show a simple cancelled notice
          const t = document.getElementById('toast-container') || (() => {
            const c = document.createElement('div'); c.id = 'toast-container';
            document.body.appendChild(c); return c;
          })();
          const el = document.createElement('div');
          el.className = 'toast';
          el.innerHTML = `<strong style="display:block;margin-bottom:.15rem">Challenge cancelled</strong><span style="font-size:.78rem;color:var(--text2)">${info.name} cancelled their ${info.mode} challenge.</span>`;
          t.appendChild(el);
          setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 6_000);
          delete active[id];
          seen.delete(id); // allow re-popup if they send a new one
        }
      }

      let hasNew = false;
      for (const c of challenges) {
        const sid = String(c.id);
        const name = c.from?.display_name || c.from?.username || c.from_username || 'Someone';
        // Track as active regardless of whether we've seen it before
        active[sid] = { name, mode: c.mode || 'versus' };
        if (!seen.has(sid)) {
          seen.add(sid);
          hasNew = true;
          const eloStr   = c.from?.elo != null ? ` (${c.from.elo} ELO)` : '';
          const modeLabel = c.mode ? ` · ${c.mode}` : '';
          showChallengePopup(`${name}${eloStr} challenged you${modeLabel}!`, c);
        }
      }

      saveSeenIds(seen);
      saveActiveMap(active);

      if (hasNew) {
        // Refresh badge
        const badgeEl = document.getElementById('navFriendsBadge');
        if (badgeEl) {
          const [fd, inboxData] = await Promise.all([friends.list(), inbox.list().catch(() => ({ challenges: [] }))]);
          const incomingReqs  = (fd.friends || []).filter(f => f.status === 'pending' && !f.isSent).length;
          const total = incomingReqs + (inboxData.challenges || []).length;
          badgeEl.textContent = total > 9 ? '9+' : total;
          total > 0 ? badgeEl.classList.remove('hidden') : badgeEl.classList.add('hidden');
        }
      }
    } catch {}
  };

  // Run immediately, then every 5 seconds
  checkChallenges();
  _challengePollInterval = setInterval(checkChallenges, 5_000);
}

/**
 * Remove a challenge from local tracking so it never triggers a "cancelled" notice.
 * Call this whenever the current user accepts or declines a challenge.
 */
export function forgetChallenge(id) {
  const sid = String(id);
  try {
    const active = JSON.parse(localStorage.getItem('activeChallengeMap') || '{}');
    delete active[sid];
    localStorage.setItem('activeChallengeMap', JSON.stringify(active));
  } catch {}
  try {
    const seen = new Set(JSON.parse(localStorage.getItem('seenChallengeIds') || '[]'));
    seen.delete(sid);
    localStorage.setItem('seenChallengeIds', JSON.stringify([...seen]));
  } catch {}
}

function showChallengePopup(message, challenge) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast challenge-toast';
  el.innerHTML = `<strong style="display:block;margin-bottom:.25rem">⚔ Challenge!</strong>${message}
    <div style="display:flex;gap:.5rem;margin-top:.5rem;">
      <button class="toast-btn" id="cp-accept-${challenge.id}">Accept</button>
      <button class="toast-btn toast-btn-ghost" id="cp-decline-${challenge.id}">Decline</button>
    </div>`;
  container.appendChild(el);

  const closeEl = () => {
    el.style.opacity = '0'; el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  };

  el.querySelector(`#cp-accept-${challenge.id}`)?.addEventListener('click', async () => {
    try {
      const res = await inbox.respond({ id: challenge.id, action: 'accept' });
      forgetChallenge(challenge.id);
      closeEl();
      if (res.room_code) {
        location.href = `game.html?mode=${res.mode}&room=${encodeURIComponent(res.room_code)}&autojoin=1`;
      }
    } catch (e) { /* leave el open so user can retry or decline */ }
  });

  el.querySelector(`#cp-decline-${challenge.id}`)?.addEventListener('click', async () => {
    try { await inbox.respond({ id: challenge.id, action: 'decline' }); } catch {}
    closeEl();
  });

  setTimeout(closeEl, 30_000);
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|''} [type]
 * @param {number} [duration] ms
 */
export function toast(message, type = '', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

/**
 * Resolve a rank object from an ELO number.
 * Mirrors the backend elo.js RANKS array.
 */
export function getRank(elo) {
  const RANKS = [
    { name: 'Challenger',  min: 2600, color: '#ffd700' },   // gradient rendered via CSS
    { name: 'Grandmaster', min: 2200, color: '#c8ff4a' },
    { name: 'Master',      min: 2000, color: '#b46ff0' },
    { name: 'Diamond',     min: 1800, color: '#60efff' },
    { name: 'Platinum',    min: 1600, color: '#4affda' },
    { name: 'Gold',        min: 1400, color: '#ffd700' },
    { name: 'Silver',      min: 1200, color: '#aaaaaa' },
    { name: 'Bronze',      min: 1000, color: '#cd7f32' },
    { name: 'Iron',        min:  800, color: '#8a8aa8' },
    { name: 'Unranked',    min:    0, color: '#55555c' },
  ];
  return RANKS.find(r => elo >= r.min) || RANKS[RANKS.length - 1];
}

/**
 * Render a rank badge element.
 */
export function rankBadgeEl(elo) {
  const rank = getRank(elo);
  const el   = document.createElement('span');
  el.className = `rank-badge ${rank.name}`;
  el.textContent = rank.name;
  return el;
}

/**
 * Format a duration in seconds → "3:24" or "1:02:14"
 */
export function fmtTime(seconds) {
  if (seconds < 60) return `0:${String(Math.floor(seconds)).padStart(2, '0')}`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/** Format numbers - abbreviated for large values so they never overflow tight UI cells.
 *  < 10 000          → "9,999"  (full, localised)
 *  10 000 – 999 999  → "10K" / "999.9K"
 *  1 000 000+        → "1M" / "1.2B"
 */
export function fmtNum(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return '0';
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 10_000)        return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return v.toLocaleString();
}

// ── Level / XP system ─────────────────────────────────────────────
// XP to advance from level N to N+1: 500 + (N-1)*100
// Total XP to reach level N:         (N-1)*(400 + 50*N)

/**
 * Compute level from total accumulated XP.
 */
export function getLevel(xp) {
  const v = Math.max(0, xp || 0);
  return Math.max(1, Math.floor((-350 + Math.sqrt(202500 + 200 * v)) / 100));
}

/**
 * Returns full level info for a given total XP.
 * { level, xpCurrent, xpNeeded, totalXp, pct }
 */
export function getLevelInfo(xp) {
  const totalXp = Math.max(0, xp || 0);
  const level   = getLevel(totalXp);
  const xpThisLevel = level > 1 ? (level - 1) * (400 + 50 * level) : 0;
  const xpNeeded    = level * (400 + 50 * (level + 1)) - xpThisLevel;  // = 500+(level-1)*100
  const xpCurrent   = totalXp - xpThisLevel;
  const pct         = Math.min(100, Math.round((xpCurrent / xpNeeded) * 100));
  return { level, xpCurrent, xpNeeded, totalXp, pct };
}

/**
 * Return the badge tier name for a given level.
 */
export function getLevelTier(level) {
  const l = level || 1;
  if (l >= 200) return 'challenger';
  if (l >= 150) return 'master';
  if (l >= 100) return 'diamond';
  if (l >= 75)  return 'platinum';
  if (l >= 50)  return 'gold';
  if (l >= 25)  return 'silver';
  if (l >= 10)  return 'bronze';
  return 'iron';
}

/**
 * Return an HTML string for a level badge.
 * @param {number} level
 * @returns {string}
 */
export function levelBadgeHTML(level) {
  const l    = level || 1;
  const tier = getLevelTier(l);
  return `<span style="margin-right:.25rem" class="lvl-badge lvl-${tier}" title="Level ${l}">${l}</span>`;
}
