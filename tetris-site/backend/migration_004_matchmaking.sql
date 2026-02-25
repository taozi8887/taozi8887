-- ═══════════════════════════════════════════════════════════════
--  Migration 004 - Matchmaking & Casual Versus Support
--  Remote: wrangler d1 execute tetris-db --remote --file=migration_004_matchmaking.sql
--  Local:  wrangler d1 execute tetris-db --local  --file=migration_004_matchmaking.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Casual Versus stats columns ───────────────────────────────────
ALTER TABLE stats ADD COLUMN casual_vs_played INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_vs_won    INTEGER NOT NULL DEFAULT 0;

-- ── is_ranked flag on matches ─────────────────────────────────────
-- 1 = ranked (ELO changes), 0 = casual / unranked (no ELO change)
ALTER TABLE matches ADD COLUMN is_ranked INTEGER NOT NULL DEFAULT 1;
