-- Migration 007: store pre-game ELO and final board snapshots on matches
ALTER TABLE matches ADD COLUMN p1_elo_before INTEGER DEFAULT NULL;
ALTER TABLE matches ADD COLUMN p2_elo_before INTEGER DEFAULT NULL;
ALTER TABLE matches ADD COLUMN p1_final_board TEXT DEFAULT NULL;
ALTER TABLE matches ADD COLUMN p2_final_board TEXT DEFAULT NULL;
