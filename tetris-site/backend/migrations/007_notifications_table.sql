-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 007: Achievement Inbox / Notifications table             ║
-- ║  Run once in Supabase SQL Editor.                                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 1. NOTIFICATIONS TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        VARCHAR(32)  NOT NULL DEFAULT 'info',   -- 'achievement' | 'system'
  title       VARCHAR(255) NOT NULL,
  body        TEXT         NOT NULL DEFAULT '',
  icon        VARCHAR(32)  NOT NULL DEFAULT '🔔',
  data        JSONB        NOT NULL DEFAULT '{}',
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 2. INDEXES ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read)
  WHERE read = FALSE;

-- ── 3. ROW LEVEL SECURITY ──────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own rows.
-- The backend always uses the service-role key, so RLS is for direct
-- Supabase client calls (dashboard / future client-side queries).
DROP POLICY IF EXISTS "users_own_notifications" ON public.notifications;
CREATE POLICY "users_own_notifications"
  ON public.notifications
  FOR ALL
  USING (user_id = auth.uid());

-- ── 4. RETENTION GUARD (optional) ─────────────────────────────────────────
-- Keep the table lean: auto-delete notifications older than 60 days.
-- This is a cron job you can add in Supabase → Database → Cron if desired:
--
--   SELECT cron.schedule(
--     'purge-old-notifications',
--     '0 3 * * *',
--     $$DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '60 days'$$
--   );
