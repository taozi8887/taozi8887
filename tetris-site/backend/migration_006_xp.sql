-- ──────────────────────────────────────────────────────────────────
--  Migration 006 – Account XP / Level system
--  Run:  wrangler d1 execute tetris-db --remote --file=migration_006_xp.sql
--        wrangler d1 execute tetris-db --local  --file=migration_006_xp.sql
-- ──────────────────────────────────────────────────────────────────

-- Add XP column to users (default 0 for existing accounts)
ALTER TABLE users ADD COLUMN xp REAL NOT NULL DEFAULT 0;
