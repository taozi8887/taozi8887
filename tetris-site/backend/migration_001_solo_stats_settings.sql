-- Migration 001: Add solo singleplayer stats + settings column
-- Run against the live D1 database:
--   wrangler d1 execute tetris-db --remote --file=migration_001_solo_stats_settings.sql
-- Run against the local D1 database:
--   wrangler d1 execute tetris-db --local  --file=migration_001_solo_stats_settings.sql

-- Add settings column to profiles (stores JSON game settings)
ALTER TABLE profiles ADD COLUMN settings TEXT DEFAULT '';

-- Add singleplayer stat columns to stats
ALTER TABLE stats ADD COLUMN solo_played         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN solo_lines          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN solo_best_score     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN solo_time_played_ms INTEGER NOT NULL DEFAULT 0;
