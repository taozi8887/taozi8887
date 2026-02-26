/**
 * notifications.js — Achievement inbox / notifications system.
 *
 * REST routes (all require auth):
 *   GET    /api/notifications          list (newest 50, unread first)
 *   PATCH  /api/notifications/read-all mark every unread row as read
 *   DELETE /api/notifications/all      delete every row (clear inbox)
 *   DELETE /api/notifications/:id      dismiss a single notification
 *
 * Server-side helper (called by achievements.js after earning):
 *   createNotification(userId, payload, supabase)
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import { supabase } from './index.js';

export const router = Router();

// ── GET /api/notifications ─────────────────────────────────────────────────
// Returns newest 50, ordering: unread first, then by created_at desc.
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, icon, data, read, created_at')
    .eq('user_id', req.user.id)
    .order('read',       { ascending: true  })   // unread (false) first
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[notifications] list error:', error.message);
    return res.status(500).json({ error: 'Failed to load notifications.' });
  }

  res.json({ notifications: data ?? [] });
});

// ── PATCH /api/notifications/read-all ─────────────────────────────────────
router.patch('/read-all', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.user.id)
    .eq('read', false);

  if (error) {
    console.error('[notifications] read-all error:', error.message);
    return res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
  res.json({ ok: true });
});

// ── DELETE /api/notifications/all ─────────────────────────────────────────
// Must be registered BEFORE /:id so Express matches it first.
router.delete('/all', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', req.user.id);

  if (error) {
    console.error('[notifications] clear-all error:', error.message);
    return res.status(500).json({ error: 'Failed to clear notifications.' });
  }
  res.json({ ok: true });
});

// ── DELETE /api/notifications/:id ─────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);   // prevent cross-user deletion

  if (error) {
    console.error('[notifications] delete error:', error.message);
    return res.status(500).json({ error: 'Failed to delete notification.' });
  }
  res.json({ ok: true });
});

// ── Server-side helper ─────────────────────────────────────────────────────

/**
 * Create one or more notifications for a user.
 *
 * @param {string}   userId
 * @param {object|object[]} payload  One or an array of:
 *   { type?, title, body?, icon?, data? }
 * @param {object}   sb  Supabase service-role client
 */
export async function createNotification(userId, payload, sb) {
  const rows = (Array.isArray(payload) ? payload : [payload]).map(p => ({
    user_id:    userId,
    type:       p.type  ?? 'info',
    title:      p.title ?? 'Notification',
    body:       p.body  ?? '',
    icon:       p.icon  ?? '🔔',
    data:       p.data  ?? {},
    read:       false,
  }));

  const { error } = await sb.from('notifications').insert(rows);
  if (error) console.error('[notifications] createNotification error:', error.message);
}
