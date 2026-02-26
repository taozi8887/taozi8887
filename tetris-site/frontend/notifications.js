/**
 * notifications.js — Achievement toast popup module.
 *
 * Polls for unread achievement notifications and shows them as corner
 * toasts (like challenge popups). No bell icon, no dropdown panel.
 *
 * The persistent notification inbox lives at friends.html → Notifications tab.
 *
 * Add to any page:
 *   <script type="module" src="notifications.js"></script>
 */

import API from './api.js';

// ── Rarity colours ─────────────────────────────────────────────────────────
const RARITY_COLOR = {
  common:    '#9898a8',
  uncommon:  '#4aff6e',
  rare:      '#7aadff',
  epic:      '#c87dff',
  legendary: '#ffd700',
  mythic:    '#ff6ec7',
  special:   '#ff8c42',
};

// ── localStorage tracking (avoid re-toasting) ──────────────────────────────
const SHOWN_KEY = 'shownNotifIds';
const getShown  = () => new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]'));
const addShown  = (ids) => {
  const s = getShown();
  for (const id of ids) s.add(id);
  localStorage.setItem(SHOWN_KEY, JSON.stringify([...s].slice(-300)));
};

// ── Init ───────────────────────────────────────────────────────────────────

window.addEventListener('navUserReady', (e) => {
  if (!e.detail?.id) return;
  _checkAndToast();
  setInterval(_checkAndToast, 60_000);
});

// ── Poll & toast ────────────────────────────────────────────────────────────

async function _checkAndToast() {
  try {
    const data   = await API.notifications.list();
    const notifs = data.notifications ?? [];
    const shown  = getShown();
    const fresh  = notifs.filter(n => !n.read && !shown.has(n.id));
    if (!fresh.length) return;

    for (const n of fresh) {
      _achievementToast(n);
      await new Promise(r => setTimeout(r, 400)); // slight stagger
    }

    API.notifications.markAllRead().catch(() => {});
    addShown(fresh.map(n => n.id));
  } catch {
    // Silently ignore — 401 on logged-out pages, network errors, etc.
  }
}

function _achievementToast(n) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const rarity    = n.data?.rarity ?? 'common';
  const color     = RARITY_COLOR[rarity] ?? '#9898a8';
  const hasBorder = n.data?.reward_border_slug;
  const hasTitle  = n.data?.reward_title_slug;
  const rewardTags = [
    hasBorder && `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:999px;background:rgba(100,200,255,.12);color:#60c8ff;border:1px solid rgba(100,200,255,.3)">+Border</span>`,
    hasTitle  && `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:999px;background:rgba(200,155,255,.12);color:#c87dff;border:1px solid rgba(200,155,255,.3)">+Title</span>`,
  ].filter(Boolean).join(' ');

  const el = document.createElement('div');
  el.className = 'toast';
  el.style.cssText = `border-left:3px solid ${color};max-width:290px;`;
  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.6rem">
      <div style="
        flex-shrink:0;width:32px;height:32px;border-radius:50%;
        background:${color}22;border:1.5px solid ${color}55;
        display:flex;align-items:center;justify-content:center;
        font-size:.9rem;margin-top:1px;
      ">${n.icon ?? '🏆'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.63rem;font-weight:700;color:${color};letter-spacing:.09em;text-transform:uppercase;margin-bottom:.15rem">Achievement Unlocked</div>
        <div style="font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(n.title)}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:.1rem;line-height:1.35">${_esc(n.body)}</div>
        ${rewardTags ? `<div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.3rem">${rewardTags}</div>` : ''}
      </div>
    </div>`;

  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity    = '0';
    el.style.transition = 'opacity .4s';
    setTimeout(() => el.remove(), 400);
  }, 6_000);
}

// ── Utility ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

