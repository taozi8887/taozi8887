-- migration_003_sprint_coop_lines.sql
-- Add per-mode lines-cleared columns for sprint and co-op

ALTER TABLE stats ADD COLUMN sprint_total_lines INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN coop_total_lines   INTEGER NOT NULL DEFAULT 0;
