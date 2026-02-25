-- ═══════════════════════════════════════════════════════════════
--  tetris.taozi4887.dev  -  D1 Schema
--  Remote: wrangler d1 execute tetris-db --remote --file=schema.sql
--  Local:  wrangler d1 execute tetris-db --local  --file=schema.sql
-- ═══════════════════════════════════════════════════════════════
-- Note: PRAGMA journal_mode and PRAGMA foreign_keys are omitted;
--       D1 manages journal mode internally and blocks PRAGMA
--       modifications (SQLITE_AUTH) in its authorizer callback.

-- ── Users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,           -- UUID v4
  username     TEXT NOT NULL UNIQUE,        -- 3-20 chars, alphanumeric + _ -
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,             -- PBKDF2-SHA256 hex: salt$iterations$hash
  elo          INTEGER NOT NULL DEFAULT 1000,
  created_at   INTEGER NOT NULL,           -- Unix ms
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_elo      ON users(elo DESC);

-- ── Profiles (extended info) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio        TEXT DEFAULT '',              -- max 200 chars
  avatar_key TEXT DEFAULT '',             -- R2 object key (empty = no avatar)
  country    TEXT DEFAULT '',             -- ISO 3166-1 alpha-2
  display_name TEXT DEFAULT '',           -- optional display name (max 30 chars)
  settings   TEXT DEFAULT ''             -- JSON: { keybinds, dasDelay, dasInterval, soundEnabled }
);

-- ── Lifetime Stats ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stats (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- game counts
  games_played    INTEGER NOT NULL DEFAULT 0,
  games_won       INTEGER NOT NULL DEFAULT 0,
  games_lost      INTEGER NOT NULL DEFAULT 0,
  -- by mode
  versus_played   INTEGER NOT NULL DEFAULT 0,
  versus_won      INTEGER NOT NULL DEFAULT 0,
  sprint_played        INTEGER NOT NULL DEFAULT 0,
  sprint_won           INTEGER NOT NULL DEFAULT 0,
  sprint_total_lines   INTEGER NOT NULL DEFAULT 0,
  coop_played          INTEGER NOT NULL DEFAULT 0,
  coop_won             INTEGER NOT NULL DEFAULT 0,
  coop_total_lines     INTEGER NOT NULL DEFAULT 0,
  -- aggregate
  total_lines     INTEGER NOT NULL DEFAULT 0,
  total_pieces    INTEGER NOT NULL DEFAULT 0,
  total_score     INTEGER NOT NULL DEFAULT 0,
  tetrises        INTEGER NOT NULL DEFAULT 0,
  t_spins         INTEGER NOT NULL DEFAULT 0,
  b2b_max         INTEGER NOT NULL DEFAULT 0,   -- longest B2B chain ever
  -- personal bests
  best_score      INTEGER NOT NULL DEFAULT 0,
  best_lines      INTEGER NOT NULL DEFAULT 0,
  best_sprint_ms  INTEGER NOT NULL DEFAULT 0,   -- fastest 40-line sprint (ms, 0 = none)
  max_level       INTEGER NOT NULL DEFAULT 0,
  max_combo       INTEGER NOT NULL DEFAULT 0,
  -- time played
  time_played_ms  INTEGER NOT NULL DEFAULT 0,
  -- singleplayer stats
  solo_played     INTEGER NOT NULL DEFAULT 0,
  solo_lines      INTEGER NOT NULL DEFAULT 0,
  solo_best_score INTEGER NOT NULL DEFAULT 0,
  solo_time_played_ms INTEGER NOT NULL DEFAULT 0,
  -- marathon (solo)
  marathon_played         INTEGER NOT NULL DEFAULT 0,
  marathon_best_score     INTEGER NOT NULL DEFAULT 0,
  marathon_best_lines     INTEGER NOT NULL DEFAULT 0,
  marathon_max_level      INTEGER NOT NULL DEFAULT 0,
  marathon_total_lines    INTEGER NOT NULL DEFAULT 0,
  marathon_time_played_ms INTEGER NOT NULL DEFAULT 0,
  -- casual (unranked) versus
  casual_vs_played        INTEGER NOT NULL DEFAULT 0,
  casual_vs_won           INTEGER NOT NULL DEFAULT 0,
  -- Per-mode detailed stats
  -- Ranked Versus
  versus_best_score       INTEGER NOT NULL DEFAULT 0,
  versus_tetrises         INTEGER NOT NULL DEFAULT 0,
  versus_t_spins          INTEGER NOT NULL DEFAULT 0,
  versus_b2b_max          INTEGER NOT NULL DEFAULT 0,
  versus_max_combo        INTEGER NOT NULL DEFAULT 0,
  versus_time_played_ms   INTEGER NOT NULL DEFAULT 0,
  -- Sprint Race
  sprint_best_score       INTEGER NOT NULL DEFAULT 0,
  sprint_tetrises         INTEGER NOT NULL DEFAULT 0,
  sprint_t_spins          INTEGER NOT NULL DEFAULT 0,
  sprint_b2b_max          INTEGER NOT NULL DEFAULT 0,
  sprint_max_combo        INTEGER NOT NULL DEFAULT 0,
  sprint_time_played_ms   INTEGER NOT NULL DEFAULT 0,
  -- Co-op
  coop_best_score         INTEGER NOT NULL DEFAULT 0,
  coop_tetrises           INTEGER NOT NULL DEFAULT 0,
  coop_t_spins            INTEGER NOT NULL DEFAULT 0,
  coop_b2b_max            INTEGER NOT NULL DEFAULT 0,
  coop_max_combo          INTEGER NOT NULL DEFAULT 0,
  coop_time_played_ms     INTEGER NOT NULL DEFAULT 0,
  -- Marathon per-mode
  marathon_tetrises       INTEGER NOT NULL DEFAULT 0,
  marathon_t_spins        INTEGER NOT NULL DEFAULT 0,
  marathon_b2b_max        INTEGER NOT NULL DEFAULT 0,
  marathon_max_combo      INTEGER NOT NULL DEFAULT 0,
  -- Casual Versus detailed
  casual_vs_best_score    INTEGER NOT NULL DEFAULT 0,
  casual_vs_lines         INTEGER NOT NULL DEFAULT 0,
  casual_vs_tetrises      INTEGER NOT NULL DEFAULT 0,
  casual_vs_t_spins       INTEGER NOT NULL DEFAULT 0,
  casual_vs_b2b_max       INTEGER NOT NULL DEFAULT 0,
  casual_vs_max_combo     INTEGER NOT NULL DEFAULT 0,
  casual_vs_time_played_ms INTEGER NOT NULL DEFAULT 0
);

-- ── Match History ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id           TEXT PRIMARY KEY,    -- UUID
  mode         TEXT NOT NULL,       -- 'versus' | 'sprint' | 'coop'
  room_code    TEXT NOT NULL,
  p1_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  p2_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  winner_id    TEXT,                -- NULL for draws / coop loss / incomplete
  p1_score     INTEGER DEFAULT 0,
  p2_score     INTEGER DEFAULT 0,
  p1_lines     INTEGER DEFAULT 0,
  p2_lines     INTEGER DEFAULT 0,
  p1_elo_delta INTEGER DEFAULT 0,   -- ELO change for p1 after this match
  p2_elo_delta INTEGER DEFAULT 0,
  is_ranked    INTEGER NOT NULL DEFAULT 1, -- 1=ranked, 0=casual
  duration_ms  INTEGER DEFAULT 0,
  played_at    INTEGER NOT NULL     -- Unix ms
);

CREATE INDEX IF NOT EXISTS idx_matches_p1  ON matches(p1_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_p2  ON matches(p2_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_at  ON matches(played_at DESC);

-- ── Friendships ───────────────────────────────────────────────────
-- status: 'pending' | 'accepted' | 'blocked'
-- requester_id sent the request, addressee_id received it
CREATE TABLE IF NOT EXISTS friendships (
  id           TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friends_addressee ON friendships(addressee_id, status);

-- ── Challenge Inbox ───────────────────────────────────────────────
-- status: 'pending' | 'accepted' | 'declined' | 'expired' | 'played'
CREATE TABLE IF NOT EXISTS challenges (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL DEFAULT 'versus',
  room_code    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  message      TEXT DEFAULT '',   -- optional challenge taunt / message
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL   -- auto-expire after 24h
);

CREATE INDEX IF NOT EXISTS idx_challenges_to   ON challenges(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_from ON challenges(from_user_id, status);

-- ── Sessions (optional if using stateless JWT, but useful for revocation) ──
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,         -- JWT jti claim
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT DEFAULT '',
  user_agent TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at DESC);
