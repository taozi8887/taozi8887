-- Migration 005: Expand per-mode stats so every mode has the same base metrics.
-- Run locally:  wrangler d1 execute tetris-db --local  --file=migration_005_stats_expansion.sql
-- Run remotely: wrangler d1 execute tetris-db --remote --file=migration_005_stats_expansion.sql

-- ── Ranked Versus (per-mode breakdown, previously stored in global columns) ──
ALTER TABLE stats ADD COLUMN versus_best_score     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN versus_tetrises       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN versus_t_spins        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN versus_b2b_max        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN versus_max_combo      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN versus_time_played_ms INTEGER NOT NULL DEFAULT 0;

-- ── Sprint Race ──
ALTER TABLE stats ADD COLUMN sprint_best_score     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN sprint_tetrises       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN sprint_t_spins        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN sprint_b2b_max        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN sprint_max_combo      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN sprint_time_played_ms INTEGER NOT NULL DEFAULT 0;

-- ── Co-op ──
ALTER TABLE stats ADD COLUMN coop_best_score       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_tetrises         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_t_spins          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_b2b_max          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_max_combo        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_time_played_ms   INTEGER NOT NULL DEFAULT 0;

-- ── Marathon (per-mode breakdown, previously only best_score/lines/level stored) ──
ALTER TABLE stats ADD COLUMN marathon_tetrises     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_t_spins      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_b2b_max      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_max_combo    INTEGER NOT NULL DEFAULT 0;

-- ── Casual Versus (already has played/won from migration_004; add the rest) ──
ALTER TABLE stats ADD COLUMN casual_vs_best_score    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_lines         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_tetrises      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_t_spins       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_b2b_max       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_max_combo     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_time_played_ms INTEGER NOT NULL DEFAULT 0;
