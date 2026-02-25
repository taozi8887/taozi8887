-- Migration 002: Add per-mode marathon stats (solo marathon tracking)
-- Run against the live D1 database:
--   wrangler d1 execute tetris-db --remote --file=migration_002_marathon_stats.sql
-- Run against the local D1 database:
--   wrangler d1 execute tetris-db --local  --file=migration_002_marathon_stats.sql

ALTER TABLE stats ADD COLUMN marathon_played       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_best_score   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_best_lines   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_max_level    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_total_lines  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN marathon_time_played_ms INTEGER NOT NULL DEFAULT 0;
