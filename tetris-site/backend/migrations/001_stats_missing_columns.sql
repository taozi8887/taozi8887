-- Migration: add versus_lines column (the only column missing from the initial schema)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- All other per-mode stat columns already exist from the initial schema creation.

ALTER TABLE public.stats
  ADD COLUMN IF NOT EXISTS versus_lines INTEGER NOT NULL DEFAULT 0;
