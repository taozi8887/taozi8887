-- Migration 008: Add void_reason to match history
-- A voided match keeps is_ranked=1 (was a ranked match) but has no ELO change.
-- Currently only populated when a disconnect ends a ranked game.
ALTER TABLE matches ADD COLUMN void_reason TEXT NULL;
