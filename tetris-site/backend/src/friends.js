//  Friends & Challenge Inbox 
// GET    /api/friends                  list accepted friends & pending requests
// POST   /api/friends/request          send friend request { username }
// POST   /api/friends/respond          accept/decline { id, action }
// DELETE /api/friends/:userId          remove friend
// GET    /api/inbox                    challenge inbox
// POST   /api/inbox/challenge          send challenge { username, mode }
// POST   /api/inbox/respond            respond to challenge { id, action }

import { Router } from 'express';
import { supabase, online, activegame, io } from './index.js';
import { requireAuth, requireEmailVerified } from './auth.js';

export const router = Router();

//  GET /api/friends 
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: rows, error } = await supabase
      .from('friendships')
      .select(`
        id, status,
        requester:requester_id ( id, username, display_name, elo, xp, profiles(avatar_url, country) ),
        addressee:addressee_id ( id, username, display_name, elo, xp, profiles(avatar_url, country) )
      `)
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .in('status', ['accepted', 'pending']);

    if (error) throw error;

    const friends = (rows || []).map(row => {
      const isSent = row.requester?.id === userId;
      const friend = isSent ? row.addressee : row.requester;
      const friendId = friend?.id;
      return {
        id:        row.id,
        status:    row.status,
        isSent,
        isPending: row.status === 'pending',
        friend: {
          id:           friendId,
          username:     friend?.username     || '',
          display_name: friend?.display_name || '',
          elo:          friend?.elo          ?? 1000,
          xp:           friend?.xp           ?? 0,
          avatar_url:   friend?.profiles?.avatar_url || null,
          country:      friend?.profiles?.country    || '',
          online:       online.has(friendId),
          inGame:       activegame.has(friendId),
          roomCode:     activegame.get(friendId) || null,
        },
      };
    });

    res.json({ friends });
  } catch (err) {
    console.error('GET /api/friends:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/friends/request 
router.post('/request', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username required.' });

    const userId = req.user.id;
    if (username.toLowerCase() === req.user.username?.toLowerCase())
      return res.status(400).json({ error: 'Cannot add yourself.' });

    const { data: target } = await supabase.from('users').select('id').eq('username', username).single();
    if (!target) return res.status(404).json({ error: 'User not found.' });

    // Check for existing friendship
    const { data: existing } = await supabase
      .from('friendships')
      .select('id, status')
      .or(`and(requester_id.eq.${userId},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${userId})`)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends.' });
      return res.status(409).json({ error: 'Friend request already pending.' });
    }

    await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: target.id,
      status:       'pending',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/friends/request:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/friends/respond 
router.post('/respond', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { id, action } = req.body || {};
    if (!id || !['accept', 'decline'].includes(action))
      return res.status(400).json({ error: 'id and action (accept/decline) required.' });

    const userId = req.user.id;
    const { data: row } = await supabase
      .from('friendships').select('id, requester_id, addressee_id, status').eq('id', id).single();
    if (!row) return res.status(404).json({ error: 'Request not found.' });

    if (action === 'accept') {
      if (row.addressee_id !== userId) return res.status(403).json({ error: 'Not allowed.' });
      await supabase.from('friendships').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', id);
      res.json({ ok: true });
    } else {
      // Decline or cancel (requester can cancel their own request)
      if (row.addressee_id !== userId && row.requester_id !== userId)
        return res.status(403).json({ error: 'Not allowed.' });
      await supabase.from('friendships').delete().eq('id', id);
      res.json({ ok: true });
    }
  } catch (err) {
    console.error('POST /api/friends/respond:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  DELETE /api/friends/:userId 
router.delete('/:userId', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const userId   = req.user.id;
    const friendId = req.params.userId;

    await supabase.from('friendships')
      .delete()
      .or(`and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`)
      .eq('status', 'accepted');

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/friends/:userId:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  GET /api/inbox 
router.get('/inbox', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date().toISOString();

    // Expire old challenges
    await supabase.from('challenges')
      .update({ status: 'expired' })
      .lt('expires_at', now)
      .eq('status', 'pending');

    const { data: rows } = await supabase
      .from('challenges')
      .select(`
        id, mode, room_code, status, message, created_at, expires_at,
        from_user:from_user_id ( id, username, display_name, elo, profiles(avatar_url) )
      `)
      .eq('to_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Rename from_user → from so the frontend can read c.from uniformly
    const challenges = (rows || []).map(c => ({ ...c, from: c.from_user, from_user: undefined }));
    res.json({ challenges });
  } catch (err) {
    console.error('GET /api/inbox:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/inbox/challenge 
router.post('/inbox/challenge', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { username, mode = 'versus', message = '' } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username required.' });

    const fromId = req.user.id;
    if (username.toLowerCase() === req.user.username?.toLowerCase())
      return res.status(400).json({ error: 'Cannot challenge yourself.' });

    const { data: target } = await supabase.from('users').select('id').eq('username', username).single();
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const { data: existingCh } = await supabase
      .from('challenges')
      .select('id')
      .eq('from_user_id', fromId)
      .eq('to_user_id', target.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (existingCh) return res.status(409).json({ error: 'You already have a pending challenge to this player.' });

    const roomCode    = Math.random().toString(36).slice(2, 8).toUpperCase();
    const expiresAt   = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabase.from('challenges').insert({
      from_user_id: fromId,
      to_user_id:   target.id,
      mode,
      room_code:    roomCode,
      message:      String(message).slice(0, 200),
      expires_at:   expiresAt,
    });

    // Push real-time notification to target if they're online
    const targetSocketId = online.get(target.id);
    if (targetSocketId) {
      io.to(targetSocketId).emit('challenge_received', {
        from: req.user.username,
        mode,
      });
    }

    res.json({ ok: true, room_code: roomCode, mode });
  } catch (err) {
    console.error('POST /api/inbox/challenge:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//  POST /api/inbox/respond 
router.post('/inbox/respond', requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { id, action } = req.body || {};
    if (!id || !['accept', 'decline'].includes(action))
      return res.status(400).json({ error: 'id and action required.' });

    const userId = req.user.id;
    const { data: ch } = await supabase
      .from('challenges').select('*').eq('id', id).eq('to_user_id', userId).single();
    if (!ch) return res.status(404).json({ error: 'Challenge not found.' });
    if (ch.status !== 'pending') return res.status(409).json({ error: 'Challenge already resolved.' });

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await supabase.from('challenges').update({ status: newStatus }).eq('id', id);

    if (action === 'accept') {
      return res.json({ ok: true, room_code: ch.room_code, mode: ch.mode });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/inbox/respond:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});
