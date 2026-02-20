(function () {
  'use strict';

  /* ── Disable everything on touch / mobile devices ── */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 1;
  if (isTouch) {
    // Undo the hardcoded cursor:none baked into each HTML file
    const fix = document.createElement('style');
    fix.textContent = 'html, *, *::before, *::after { cursor: auto !important; }';
    document.head.appendChild(fix);
    document.documentElement.style.cursor = '';
    // Still run page-transition reveal so bfcache / back-button works
    // (defined below — skip to the page-transitions IIFE only)
  }

  if (!isTouch) {

  const ACCENT = '#c8ff4a';
  const ACCENT_GLOW = 'rgba(200,255,74,0.18)';

  /* ── Inject styles ── */
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { cursor: none !important; }

    /* Prevent accidental text/element selection; allow it in actual input fields */
    * { user-select: none; -webkit-user-select: none; }
    input, textarea, [contenteditable="true"] {
      user-select: text !important;
      -webkit-user-select: text !important;
    }

    /* Prevent link/image dragging */
    a, img { -webkit-user-drag: none; user-drag: none; }

    /* Accent-coloured highlight for the cases where selection is intentional */
    ::selection      { background: ${ACCENT}; color: #0a0a0b; }
    ::-moz-selection { background: ${ACCENT}; color: #0a0a0b; }

    #_cur-dot {
      position: fixed;
      width: 7px;
      height: 7px;
      background: ${ACCENT};
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483647;
      top: 0; left: 0;
      transform: translate(-50%, -50%);
      transition: width .12s ease, height .12s ease, background .12s ease, opacity .2s ease;
      will-change: transform, left, top;
    }

    #_cur-ring {
      position: fixed;
      width: 34px;
      height: 34px;
      border: 1.5px solid ${ACCENT};
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483646;
      top: 0; left: 0;
      transform: translate(-50%, -50%);
      opacity: 0.65;
      transition:
        width .22s cubic-bezier(.23,1,.32,1),
        height .22s cubic-bezier(.23,1,.32,1),
        opacity .22s ease,
        border-color .22s ease,
        border-width .22s ease,
        box-shadow .22s ease;
      will-change: left, top;
    }

    /* hover */
    #_cur-dot._hov  { width: 9px; height: 9px; }
    #_cur-ring._hov {
      width: 52px; height: 52px;
      opacity: 0.9;
      box-shadow: 0 0 12px 1px ${ACCENT_GLOW};
    }

    /* click */
    #_cur-dot._clk  { width: 4px; height: 4px; opacity: 0.7; }
    #_cur-ring._clk { width: 22px; height: 22px; opacity: 1; }

    /* hidden (mouse left window) */
    #_cur-dot._out, #_cur-ring._out { opacity: 0 !important; }

    /* ripple burst on click */
    @keyframes _curRipple {
      0%   { width: 0; height: 0; opacity: 0.55; }
      100% { width: 90px; height: 90px; opacity: 0; }
    }
    ._cur-ripple {
      position: fixed;
      border-radius: 50%;
      background: ${ACCENT_GLOW};
      pointer-events: none;
      z-index: 2147483645;
      top: 0; left: 0;
      transform: translate(-50%, -50%);
      animation: _curRipple 0.55s cubic-bezier(.23,1,.32,1) forwards;
    }

    /* trail particles */
    @keyframes _curTrail {
      0%   { transform: translate(-50%,-50%) scale(1); opacity: 0.45; }
      100% { transform: translate(-50%,-50%) scale(0); opacity: 0; }
    }
    ._cur-trail {
      position: fixed;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: ${ACCENT};
      pointer-events: none;
      z-index: 2147483644;
      top: 0; left: 0;
      animation: _curTrail 0.5s ease-out forwards;
    }

    /* ── Cursor label ── */
    #_cur-label {
      position: fixed;
      pointer-events: none;
      z-index: 2147483648;
      top: 0; left: 0;
      font-family: 'DM Mono', monospace;
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #0a0a0b;
      background: ${ACCENT};
      padding: 2px 7px 2px 6px;
      border-radius: 20px;
      transform: translate(14px, 14px);
      opacity: 0;
      transition: opacity 0.18s ease;
      white-space: nowrap;
    }
    #_cur-label._show { opacity: 1; }

    /* ── View state: hero/project cards ── */
    #_cur-dot._view { opacity: 0; }
    #_cur-ring._view {
      width: 58px; height: 58px;
      border-radius: 14px;
      border-width: 2px;
      opacity: 1;
      box-shadow: 0 0 22px 4px ${ACCENT_GLOW};
    }

    /* ── Target state: game grid cells ── */
    #_cur-dot._target { width: 3px; height: 3px; }
    #_cur-ring._target {
      width: 26px; height: 26px;
      border-radius: 3px;
      border-width: 2px;
      opacity: 1;
    }

    /* ── Drag state: 3D cube / draggable scenes ── */
    #_cur-dot._drag { opacity: 0; }
    #_cur-ring._drag {
      width: 50px; height: 50px;
      border-style: dashed;
      border-width: 1.5px;
      opacity: 0.85;
      box-shadow: 0 0 16px 2px ${ACCENT_GLOW};
      animation: _curSpin 2.8s linear infinite;
    }
    @keyframes _curSpin {
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    /* ── Precision state: canvas / drawing ── */
    #_cur-dot._precision { width: 2px; height: 2px; }
    #_cur-ring._precision {
      width: 16px; height: 16px;
      border-width: 1px;
      opacity: 1;
    }

    /* ── Swipe state: project rows ── */
    #_cur-dot._swipe { width: 6px; height: 6px; }
    #_cur-ring._swipe {
      width: 68px; height: 28px;
      opacity: 0.65;
    }

    /* ── Text caret state: text inputs only ── */
    #_cur-dot._text {
      width: 2px;
      height: 20px;
      border-radius: 1px;
      /* no blinking — steady bar */
    }
    #_cur-ring._text {
      width: 0; height: 0;
      opacity: 0;
    }

    /* ── Fit state: ring traces element bounds (stat-card etc.) ── */
    #_cur-dot._fit { width: 4px; height: 4px; opacity: 0.7; }
    #_cur-ring._fit {
      /* w/h set dynamically via JS */
      opacity: 0.7;
      border-width: 1.5px;
      transition:
        width .28s cubic-bezier(.23,1,.32,1),
        height .28s cubic-bezier(.23,1,.32,1),
        border-radius .28s cubic-bezier(.23,1,.32,1),
        opacity .22s ease,
        border-color .22s ease,
        box-shadow .22s ease;
    }

    /* ── Accent-button state: inverted dark dot + filled pill ── */
    #_cur-dot._accent {
      width: 8px; height: 8px;
      background: #0a0a0b;
    }
    #_cur-ring._accent {
      width: 56px; height: 34px;
      border-radius: 20px;
      background: rgba(10,10,11,0.14);
      border-color: #0a0a0b;
      border-width: 1.5px;
      opacity: 0.7;
    }

    /* ── Glow / text-reveal state: big display headings ── */
    #_cur-dot._glow { width: 0; height: 0; opacity: 0; }
    #_cur-ring._glow {
      width: 130px; height: 130px;
      border-width: 1.5px;
      opacity: 0.55;
      border-color: ${ACCENT};
      box-shadow: 0 0 18px 4px ${ACCENT_GLOW};
    }
    /* ring collapses when cursor is between glyphs */
    #_cur-ring._glow._glow-off {
      width: 34px; height: 34px;
      opacity: 0.35;
      box-shadow: none;
    }

    /* Overlay: cloned heading text in accent color, clipped to a circle */
    ._cur-reveal-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: ${ACCENT};
      clip-path: circle(65px at var(--_crx, -999px) var(--_cry, -999px));
      font: inherit;
      letter-spacing: inherit;
      line-height: inherit;
      white-space: inherit;
      overflow: visible;
      z-index: 1;
    }
    /* accent-coloured child spans inside the overlay show white */
    ._cur-reveal-overlay .accent { color: #ffffff; }
    ._cur-reveal-overlay [style*="var(--accent)"] { color: #ffffff !important; }
    ._cur-reveal-overlay [style*="var(--accent2)"] { color: #ffffff !important; }
    ._cur-reveal-overlay [style*="var(--accent3)"] { color: #ffffff !important; }
  `;
  document.head.appendChild(style);

  /* ── Create elements ── */
  const dot   = document.createElement('div'); dot.id   = '_cur-dot';
  const ring  = document.createElement('div'); ring.id  = '_cur-ring';
  const label = document.createElement('div'); label.id = '_cur-label';

  /* Restore last known position from sessionStorage so cursor
     doesn't flash at 0,0 or jump in from off-screen between pages */
  let _savedPos = null;
  try { _savedPos = JSON.parse(sessionStorage.getItem('_curPos')); } catch (_) {}

  if (_savedPos) {
    // Place cursor at saved position and show immediately —
    // first mousemove will snap to real position within one frame anyway
    dot.style.left  = _savedPos.x + 'px';
    dot.style.top   = _savedPos.y + 'px';
    ring.style.left = _savedPos.x + 'px';
    ring.style.top  = _savedPos.y + 'px';
    // No _out — visible straight away

    // Restore the previous page's cursor visual state (mode classes + ring size)
    // so the cursor shape doesn't reset during the inter-page curtain fade.
    let _savedState = null;
    try { _savedState = JSON.parse(sessionStorage.getItem('_curState')); } catch (_) {}
    if (_savedState) {
      // Suppress CSS transition during snapshot restore — ring should snap
      // immediately to the previous shape, not sweep in from default size.
      ring.style.transition = 'none';
      dot.style.transition  = 'none';
      if (_savedState.dotCls)  _savedState.dotCls.split(' ').filter(Boolean).forEach(c => dot.classList.add(c));
      if (_savedState.ringCls) _savedState.ringCls.split(' ').filter(Boolean).forEach(c => ring.classList.add(c));
      if (_savedState.ringW)   ring.style.width        = _savedState.ringW;
      if (_savedState.ringH)   ring.style.height       = _savedState.ringH;
      if (_savedState.ringBr)  ring.style.borderRadius = _savedState.ringBr;
    }
  } else {
    dot.classList.add('_out');
    ring.classList.add('_out');
  }
  document.body.append(dot, ring, label);
  // Re-enable transitions (was suppressed during state snapshot restore above)
  requestAnimationFrame(() => { dot.style.transition = ''; ring.style.transition = ''; });

  /* Block any hover-triggered cursor effects until the first real mousemove.
     Prevents glow / blur from firing on whatever element happens to sit
     under the saved cursor position as the new page renders. */
  let _mouseReady = false;

  /* ── State ── */
  let mx = _savedPos ? _savedPos.x : -200;
  let my = _savedPos ? _savedPos.y : -200;
  let rx = mx, ry = my;
  let isOut = !_savedPos; // already visible if we had a saved position
  let magTarget = null; // magnetic pull target {cx, cy}
  let currentMode = null;
  let fitEl = null;     // element whose bounds ring should trace (_fit mode)
  let currentHeading = null; // heading element with active text-reveal

  /* ── Mouse tracking ── */
  let _posSaveTimer = null;
  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    // Persist position (throttled to ~10/s) so the next page can pick it up
    if (!_posSaveTimer) {
      _posSaveTimer = setTimeout(() => {
        try { sessionStorage.setItem('_curPos', JSON.stringify({x: mx, y: my})); } catch(_){}
        _posSaveTimer = null;
      }, 100);
    }
    if (isOut) {
      // Snap ring on first entry to avoid sweeping from off-screen
      rx = mx; ry = my;
      dot.classList.remove('_out');
      ring.classList.remove('_out');
      isOut = false;
    }
    _mouseReady = true;
    // Magnetic pull toward nav links
    const px = magTarget ? mx + (magTarget.cx - mx) * 0.28 : mx;
    const py = magTarget ? my + (magTarget.cy - my) * 0.28 : my;
    dot.style.left = px + 'px';
    dot.style.top  = py + 'px';
    label.style.left = mx + 'px';
    label.style.top  = my + 'px';

    // Update text-reveal clip position (element-relative coords for clip-path)
    if (currentHeading) {
      let overText = false;
      try {
        const range = document.caretRangeFromPoint
          ? document.caretRangeFromPoint(mx, my)
          : (document.caretPositionFromPoint ? document.caretPositionFromPoint(mx, my) : null);
        if (range) {
          const node = range.startContainer || range.offsetNode;
          overText = !!node && node.nodeType === Node.TEXT_NODE && currentHeading.contains(node);
        }
      } catch (_) {}
      const ov = currentHeading._curOverlay;
      if (ov) {
        if (overText) {
          const r = currentHeading.getBoundingClientRect();
          ov.style.setProperty('--_crx', (mx - r.left) + 'px');
          ov.style.setProperty('--_cry', (my - r.top)  + 'px');
          ring.classList.remove('_glow-off');
        } else {
          ov.style.setProperty('--_crx', '-999px');
          ov.style.setProperty('--_cry', '-999px');
          ring.classList.add('_glow-off');
        }
      }
    }
  });

  document.addEventListener('mouseleave', () => {
    isOut = true;
    dot.classList.add('_out');
    ring.classList.add('_out');
  });

  document.addEventListener('mouseenter', () => {
    isOut = false;
    dot.classList.remove('_out');
    ring.classList.remove('_out');
  });

  /* ── Smooth ring animation (lerp) ── */
  let lastTrailTime = 0;
  function tick(ts) {
    const lerpSpeed = currentMode === '_precision' ? 0.22
                    : currentMode === '_glow'      ? 1.0   // snaps exactly to cursor
                    : 0.11;

    if (fitEl) {
      // In fit mode: lerp ring to element's center and match its dimensions
      const r = fitEl.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      rx += (cx - rx) * 0.14;
      ry += (cy - ry) * 0.14;
      ring.style.width        = r.width  + 'px';
      ring.style.height       = r.height + 'px';
      const br = parseFloat(getComputedStyle(fitEl).borderRadius) || 8;
      ring.style.borderRadius = br + 'px';
    } else {
      rx += (mx - rx) * lerpSpeed;
      ry += (my - ry) * lerpSpeed;
    }
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';

    // Emit trail particle every ~35ms while moving
    const dist = Math.hypot(mx - rx, my - ry);
    if (dist > 4 && ts - lastTrailTime > 35) {
      lastTrailTime = ts;
      const t = document.createElement('div');
      t.className = '_cur-trail';
      t.style.left = rx + 'px';
      t.style.top  = ry + 'px';
      document.body.appendChild(t);
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ── Mode system ── */
  const ALL_MODES = ['_hov','_view','_target','_drag','_precision','_swipe','_text','_fit','_accent','_glow'];
  const HEADING_SEL = '.hero-title, .about-heading, .contact-heading, .project-name, .modal-heading, .result-heading, .overlay-title, .howto-title';

  function setMode(mode, labelText, colorOverride, el) {
    ALL_MODES.forEach(c => { dot.classList.remove(c); ring.classList.remove(c); });
    // Reset dynamic ring sizing unless entering fit mode
    if (mode !== '_fit') {
      ring.style.width = '';
      ring.style.height = '';
      ring.style.borderRadius = '';
      fitEl = null;
    } else {
      fitEl = el || null;
    }
    // Clean up text-reveal overlay on previous heading
    if (currentHeading) {
      if (currentHeading._curOverlay) {
        currentHeading._curOverlay.remove();
        delete currentHeading._curOverlay;
      }
      ring.classList.remove('_glow-off');
      currentHeading = null;
    }
    // Create overlay in glow mode
    if (mode === '_glow' && el) {
      currentHeading = el;
      // ensure the heading is a positioning context
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const ov = document.createElement('div');
      ov.className = '_cur-reveal-overlay';
      ov.innerHTML = el.innerHTML;
      el.appendChild(ov);
      el._curOverlay = ov;
      rx = mx; ry = my; // snap ring so it doesn't sweep in
      ring.classList.add('_glow-off'); // start collapsed until cursor is over a glyph
    }
    currentMode = mode || null;
    if (mode) { dot.classList.add(mode); ring.classList.add(mode); }
    label.textContent = labelText || '';
    labelText ? label.classList.add('_show') : label.classList.remove('_show');
    ring.style.borderColor = colorOverride || '';
    ring.style.boxShadow   = colorOverride
      ? `0 0 14px 2px ${colorOverride}44`
      : '';
    dot.style.background   = (mode === '_text' || mode === '_accent') ? ''
                           : colorOverride ? colorOverride
                           : '';
  }

  /* Text input types that warrant a caret cursor */
  const TEXT_INPUT_TYPES = new Set(['text','email','password','search','url','tel','number','']);

  /* Helper: returns true if an element has an accent-coloured background (computed) */
  function isAccentBg(el) {
    if (!el) return false;
    const bg = getComputedStyle(el).backgroundColor;
    // accent = rgb(200, 255, 74) — check approximate match
    const m = bg.match(/rgb\(?(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const [, r, g, b] = m.map(Number);
    return r > 150 && g > 200 && b < 120; // matches lime/yellow-green family
  }

  /* Helper: derive smart label from a button/link element */
  function smartLabel(el) {
    if (!el) return null;
    const cls = el.className || '';
    const txt = (el.textContent || '').trim().toLowerCase();
    if (el.closest('.modal-close') || txt.includes('close') || txt === '×' || txt === 'x') return 'CLOSE';
    if (txt.includes('send') || cls.includes('btn-send'))  return 'SEND';
    if (txt.includes('start') || txt.includes('play'))     return 'PLAY';
    if (txt.includes('restart') || txt.includes('retry') || txt.includes('again')) return 'RETRY';
    if (txt.includes('save') || txt.includes('download'))  return 'SAVE';
    if (txt.includes('submit'))                            return 'SUBMIT';
    if (txt.includes('skip'))                              return 'SKIP';
    if (txt.includes('next'))                              return 'NEXT';
    if (txt.includes('menu') || txt.includes('home'))      return 'MENU';
    if (cls.includes('diff-btn') || cls.includes('mode-btn')) return 'SELECT';
    return null;
  }

  /* Priority-ordered mode map – first match wins */
  const MODE_MAP = [
    // Back-to-home button — ring fits the button pill
    { fn: el => !!el.closest('#_back-btn'),
      mode: '_fit', lbl: 'HOME',
      elFn: el => el.closest('#_back-btn') },

    // Text inputs only (not range/checkbox/radio/color/etc.)
    { fn: el => el.matches('textarea') || (el.matches('input') && TEXT_INPUT_TYPES.has((el.type||'').toLowerCase())),
      mode: '_text', lbl: null },

    // Canvas / drawing precision
    { fn: el => !!el.closest('.canvas-frame, canvas'), mode: '_precision', lbl: null },

    // 3D / draggable scenes
    { fn: el => !!el.closest('.cube-scene, .scene-wrap, .hero-cube'), mode: '_drag', lbl: 'DRAG' },

    // game grid cells
    { fn: el => !!el.closest('.ttt-cell, .mc, .t2048'), mode: '_target', lbl: null },

    // stat-card → ring traces the box
    { fn: el => !!el.closest('.stat-card'), mode: '_fit', lbl: null },

    // setting-card → ring traces the box, no label
    { fn: el => !!el.closest('.setting-card'), mode: '_fit', lbl: null },

    // diff-card
    { fn: el => !!el.closest('.diff-card'), mode: '_view', lbl: 'SELECT' },

    // hero cards / project cards
    { fn: el => !!el.closest('.hero-card'), mode: '_view', lbl: 'OPEN →' },

    // accent-background buttons — detected by computed background colour
    { fn: el => {
        const btn = el.closest('button, [role="button"], a.btn, .submit-btn, .project-cta, .btn-send');
        return btn ? isAccentBg(btn) : false;
      }, mode: '_accent', lbl: null },

    // regular buttons — derive label from content
    { fn: el => !!el.closest('button, [role="button"]'),
      mode: '_hov',
      lbl: el => smartLabel(el.closest('button, [role="button"]')) },

    // big display headings — text reveal clip-mask
    { fn: el => !!el.closest(HEADING_SEL),
      mode: '_glow',
      lbl: null,
      elFn: el => el.closest(HEADING_SEL) },

    // project rows
    { fn: el => !!el.closest('.project-row'), mode: '_swipe', lbl: 'EXPLORE →' },
  ];

  const GENERIC_HOV = 'a, label, select, [tabindex]:not([tabindex="-1"])';
  const NAV_MAG     = 'nav a, .logo, nav button, .nav-links a';
  const SWATCH_SEL  = '.color-swatch-inner, .stop-swatch, .grad-thumb, .leg-sw, .legend-swatch';

  /* ── Shared hover evaluator — called by mouseover AND scroll ── */
  function evaluateHover(t) {
    if (!t) { setMode(null, null, null); magTarget = null; return; }

    // Color swatch — ring mirrors swatch color
    const sw = t.closest(SWATCH_SEL);
    if (sw) {
      const col = getComputedStyle(sw).backgroundColor;
      if (col && col !== 'rgba(0, 0, 0, 0)') { setMode('_hov', null, col); return; }
    }

    // Priority mode map
    for (const entry of MODE_MAP) {
      if (entry.fn(t)) {
        const lbl = typeof entry.lbl === 'function' ? entry.lbl(t) : entry.lbl;
        const fitTarget  = (entry.mode === '_fit')  ? (t.closest('#_back-btn') || t.closest('.stat-card, .setting-card')) : null;
        const glowTarget = (entry.elFn)             ? entry.elFn(t) : null;
        setMode(entry.mode, lbl, null, fitTarget || glowTarget);
        // Magnetic pull
        const navEl = t.closest(NAV_MAG);
        if (navEl) {
          const r = navEl.getBoundingClientRect();
          magTarget = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        } else {
          magTarget = null;
        }
        return;
      }
    }

    // Generic interactive hover
    if (t.closest(GENERIC_HOV)) { setMode('_hov', null, null); }
    else { setMode(null, null, null); }

    // Magnetic pull
    const navEl = t.closest(NAV_MAG);
    if (navEl) {
      const r = navEl.getBoundingClientRect();
      magTarget = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    } else {
      magTarget = null;
    }
  }

  document.addEventListener('mouseover', e => {
    if (!_mouseReady) return;
    evaluateHover(e.target);
  });

  document.addEventListener('mouseout', e => {
    setMode(null, null, null);
  });

  /* ── Re-evaluate hover when page scrolls (cursor stays still, elements move) ── */
  window.addEventListener('scroll', () => {
    if (!_mouseReady || isOut) return;
    const t = document.elementFromPoint(mx, my);
    evaluateHover(t);
  }, { passive: true, capture: true });

  /* ── Magnetic pull for nav elements ── */
  document.addEventListener('mouseover', e => {
    const el = e.target.closest(NAV_MAG);
    if (el) {
      const r = el.getBoundingClientRect();
      magTarget = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(NAV_MAG)) magTarget = null;
  });

  /* ── Prevent drag on links and images ── */
  document.addEventListener('dragstart', e => {
    if (e.target.closest('a, img')) e.preventDefault();
  });

  /* ── Disable context menu globally ── */
  document.addEventListener('contextmenu', e => e.preventDefault());

  /* ── Click burst ── */
  document.addEventListener('mousedown', e => {
    dot.classList.add('_clk');
    ring.classList.add('_clk');

    const r = document.createElement('div');
    r.className = '_cur-ripple';
    r.style.left = e.clientX + 'px';
    r.style.top  = e.clientY + 'px';
    document.body.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  });

  document.addEventListener('mouseup', () => {
    dot.classList.remove('_clk');
    ring.classList.remove('_clk');
  });

  /* ── Shared transition helper (set by blur IIFE, used by transition IIFE) ── */
  let clearMag = () => {};

  /* ── Button / Link focus: blur surround with animated spot ── */
  (function () {
    const magCSS = document.createElement('style');
    magCSS.textContent = `
      #_btn-mag-overlay {
        position: fixed;
        inset: 0;
        z-index: 9990;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.22s ease;
        backdrop-filter: blur(7px) brightness(0.72);
        -webkit-backdrop-filter: blur(7px) brightness(0.72);
        background: rgba(0,0,0,0.08);
      }
      #_btn-mag-overlay._active { opacity: 1; }

      /* Hovered element scales up very slightly — zoom feel, no layout shift */
      ._btn-mag-top {
        transform: scale(1.055) !important;
        transition: transform 0.25s cubic-bezier(.23,1,.32,1) !important;
      }
    `;
    document.head.appendChild(magCSS);

    const ov = document.createElement('div');
    ov.id = '_btn-mag-overlay';
    document.body.appendChild(ov);

    const SEL = 'button, [role="button"], a, .btn, .lci, .lm';

    // Animated spot state
    let cx = 0, cy = 0, cr = 0;   // current (lerped) position + radius
    let tx = 0, ty = 0, tr = 0;   // target
    let rafId      = null;
    let visible    = false;
    let activeMagBtn = null;
    let pendingEnd = null;

    function buildMask(x, y, r) {
      // Many soft stops so the ring edge is invisible — gradient disperses over a wide band
      return `radial-gradient(circle ${r.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px,
        transparent   0%,
        transparent  42%,
        rgba(0,0,0,0.04) 52%,
        rgba(0,0,0,0.13) 60%,
        rgba(0,0,0,0.28) 68%,
        rgba(0,0,0,0.48) 76%,
        rgba(0,0,0,0.68) 84%,
        rgba(0,0,0,0.85) 91%,
        black           100%)`;
    }

    function applyMask() {
      const m = buildMask(cx, cy, cr);
      ov.style.webkitMaskImage = m;
      ov.style.maskImage       = m;
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function tick() {
      const spdPos = 0.16;
      const spdRad = 0.22; // radius catches up faster than position
      cx = lerp(cx, tx, spdPos);
      cy = lerp(cy, ty, spdPos);
      cr = lerp(cr, tr, spdRad);
      applyMask();
      if (Math.hypot(tx - cx, ty - cy) + Math.abs(tr - cr) > 0.3) {
        rafId = requestAnimationFrame(tick);
      } else {
        cx = tx; cy = ty; cr = tr;
        applyMask();
        rafId = null;
      }
    }

    function targetFromBtn(btn) {
      const r = btn.getBoundingClientRect();
      tx = r.left + r.width  / 2;
      ty = r.top  + r.height / 2;
      tr = Math.max(r.width, r.height) * 0.78 + 32;
    }

    function startMag(btn) {
      // Don't activate blur before first real mousemove
      if (!_mouseReady) return;
      // Cancel any pending hide
      if (pendingEnd) { clearTimeout(pendingEnd); pendingEnd = null; }
      if (activeMagBtn === btn) return;
      activeMagBtn = btn;
      targetFromBtn(btn);

      if (!visible) {
        // First (re)appearance — if we have a prior position, lerp from it;
        // otherwise snap so there's no sweep from 0,0
        if (cx === 0 && cy === 0) { cx = tx; cy = ty; cr = tr; applyMask(); }
        visible = true;
        ov.classList.add('_active');
      }
      // Always start/restart the lerp tick (covers both first appearance and glide)
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
      btn.classList.add('_btn-mag-top');
    }

    function endMag(btn) {
      if (!btn || activeMagBtn !== btn) return;
      btn.classList.remove('_btn-mag-top');
      // Longer delay so a quick cross to an adjacent button glides instead of snapping
      pendingEnd = setTimeout(() => {
        activeMagBtn = null;
        visible      = false;
        ov.classList.remove('_active');
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        pendingEnd = null;
      }, 120);
    }

    // Expose cleanup so the page-transition IIFE can kill blur before navigating
    clearMag = function () {
      if (activeMagBtn) activeMagBtn.classList.remove('_btn-mag-top');
      activeMagBtn = null;
      visible = false;
      ov.classList.remove('_active');
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (pendingEnd) { clearTimeout(pendingEnd); pendingEnd = null; }
    };

    document.addEventListener('mouseover', e => {
      const btn = e.target.closest(SEL);
      if (btn) startMag(btn);
    });
    document.addEventListener('mouseout', e => {
      const btn = e.target.closest(SEL);
      if (btn && !btn.contains(e.relatedTarget)) endMag(btn);
    });
    // When a click triggers a navigation/action the button leaves the DOM
    // and mouseout never fires — force-clear the blur immediately on click.
    document.addEventListener('click', () => {
      clearMag();
    }, true);
  })();

  /* ── Fullscreen toggle (game pages only) ── */
  (function () {
    const path = location.pathname;
    const isGame = !path.endsWith('index.html') && !path.endsWith('/') && path !== '';
    if (!isGame) return;

    const fsStyle = document.createElement('style');
    fsStyle.textContent = `
      /* Centre the game title in the header */
      header {
        position: relative;
      }
      header .logo {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        cursor: none;
      }

      #_fs-btn {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        border-radius: 8px;
        border: 1px solid rgba(200,255,74,0.3);
        background: transparent;
        color: #c8ff4a;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.55;
        transition: opacity 0.2s, border-color 0.2s, transform 0.15s;
      }
      #_fs-btn:hover {
        opacity: 1;
        border-color: #c8ff4a;
        transform: scale(1.08);
      }
      #_fs-btn svg { display: block; }
    `;
    document.head.appendChild(fsStyle);

    const ICON_EXPAND = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="1,5 1,1 5,1"/><polyline points="11,1 15,1 15,5"/>
      <polyline points="15,11 15,15 11,15"/><polyline points="5,15 1,15 1,11"/>
    </svg>`;

    const ICON_COMPRESS = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="5,1 5,5 1,5"/><polyline points="11,1 11,5 15,5"/>
      <polyline points="15,11 11,11 11,15"/><polyline points="1,11 5,11 5,15"/>
    </svg>`;

    const btn = document.createElement('button');
    btn.id = '_fs-btn';
    btn.innerHTML = ICON_EXPAND;
    const _fsHeaderRight = document.querySelector('.header-right');
    if (_fsHeaderRight) _fsHeaderRight.appendChild(btn);
    else document.body.appendChild(btn);

    function isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement)
          || window.innerHeight === screen.height;
    }

    function updateIcon() {
      btn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND;
    }

    function toggle() {
      if (!isFullscreen()) {
        (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)
          .call(document.documentElement);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    }

    btn.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', updateIcon);
    document.addEventListener('webkitfullscreenchange', updateIcon);
    window.addEventListener('resize', updateIcon);

    /* ── Back to index button ── */
    const backStyle = document.createElement('style');
    backStyle.textContent = `
      #_back-btn {
        flex-shrink: 0;
        height: 32px;
        padding: 0 12px 0 8px;
        border-radius: 8px;
        border: 1px solid rgba(200,255,74,0.3);
        background: transparent;
        color: #c8ff4a;
        display: flex;
        align-items: center;
        gap: 7px;
        opacity: 0.6;
        transition: opacity 0.25s, border-color 0.25s, transform 0.25s;
        text-decoration: none;
      }
      #_back-btn:hover {
        opacity: 1;
        border-color: #c8ff4a;
        transform: translateY(-1px);
      }
      #_back-btn:active {
        transform: translateY(1px) scale(0.97);
      }
      #_back-btn svg {
        display: block;
        flex-shrink: 0;
        transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
      }
      #_back-btn:hover svg {
        transform: scale(1.2) rotate(-8deg);
      }
      #_back-btn-label {
        font-family: 'DM Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: letter-spacing 0.25s ease;
      }
      #_back-btn:hover #_back-btn-label {
        letter-spacing: 0.18em;
      }

      @media (max-width: 540px) {
        header {
          padding-top: 14px !important;
          padding-left: 14px !important;
          padding-right: 14px !important;
          gap: 8px;
        }
        header .logo {
          position: static !important;
          transform: none !important;
          left: auto !important;
          pointer-events: auto !important;
          flex: 1;
          text-align: center;
        }
        .version { display: none !important; }
        #_fs-btn { display: none !important; }
        #_back-btn-label { display: none; }
        #_back-btn { padding: 0 8px; height: 30px; }
        .header-right { gap: 8px; }
        .btn.sm { padding: 6px 12px; font-size: 11px; }
        footer {
          flex-direction: column !important;
          align-items: center !important;
          gap: 6px !important;
          text-align: center !important;
          padding: 20px 16px !important;
        }
      }
    `;
    document.head.appendChild(backStyle);

    const backBtn = document.createElement('a');
    backBtn.id = '_back-btn';
    backBtn.href = 'index.html';
    backBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5L8 1l7 5.5V15a1 1 0 01-1 1H5a1 1 0 01-1-1v-4H2v4a1 1 0 01-1 1"/>
      <rect x="5" y="11" width="4" height="5" rx="0.5"/>
    </svg><span id="_back-btn-label">go back</span>`;
    const _backHeader = document.querySelector('header');
    if (_backHeader) _backHeader.insertBefore(backBtn, _backHeader.firstChild);
    else document.body.appendChild(backBtn);
  })();

  } // end if (!isTouch)

  /* ── Page transitions ── */
  (function () {
    /* The curtain <div id="_pg-curtain"> is hard-coded in every HTML file as the
       first child of <body> with inline style="...background:#0a0a0b".
       It's opaque from first paint, so the page content (including logo animations)
       is hidden until we explicitly fade it out.  The custom cursor has a higher
       z-index, so it's visible above the curtain the whole time — giving the
       illusion that the cursor persists continuously between pages. */
    const pgStyle = document.createElement('style');
    pgStyle.textContent = `
      @keyframes _curtainIn  { from { opacity:1; } to { opacity:0; } }
      @keyframes _curtainOut { from { opacity:0; } to { opacity:1; } }
      #_pg-curtain {
        position: fixed;
        inset: 0;
        z-index: 99995;
        pointer-events: none;
      }
      /* Block pointer events while fading out (prevents double-clicks during exit) */
      #_pg-curtain._out { animation: _curtainOut 0.18s ease both; pointer-events: all; }
      /* Reveal animation — starts opaque, fades to clear */
      #_pg-curtain._in  { animation: _curtainIn  0.32s cubic-bezier(.23,1,.32,1) both; }
    `;
    document.head.appendChild(pgStyle);

    /* Reuse the hard-coded static curtain from HTML; fall back to creating one */
    let curtain = document.getElementById('_pg-curtain');
    if (!curtain) {
      curtain = document.createElement('div');
      curtain.id = '_pg-curtain';
      curtain.style.cssText = 'position:fixed;inset:0;z-index:99995;pointer-events:none;background:#0a0a0b';
      document.body.insertBefore(curtain, document.body.firstChild);
    }

    /* Fade-in reveal — curtain was opaque on first paint, now animate to transparent */
    function revealPage() {
      curtain.classList.add('_in');
      curtain.addEventListener('animationend', () => {
        curtain.classList.remove('_in');
        curtain.style.opacity = '0'; // hold transparent once animation is done
      }, { once: true });
    }
    document.addEventListener('DOMContentLoaded', revealPage);
    /* bfcache restore (mobile browser back/forward): DOMContentLoaded never fires,
       so we must listen for pageshow with persisted=true and instantly clear curtain */
    window.addEventListener('pageshow', e => {
      if (e.persisted) {
        curtain.classList.remove('_in', '_out');
        curtain.style.opacity = '0';
      }
    });

    /* Intercept internal same-origin link clicks → fade out first */
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (a.target === '_blank') return;
      if (href.startsWith('http') && !href.startsWith(location.origin)) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      e.preventDefault();
      // Save cursor visual state so the next page can restore it seamlessly
      try {
        sessionStorage.setItem('_curState', JSON.stringify({
          dotCls:  dot.className.replace('_cur-dot', '').trim(),
          ringCls: ring.className.replace('_cur-ring', '').trim(),
          ringW:   ring.style.width,
          ringH:   ring.style.height,
          ringBr:  ring.style.borderRadius,
        }));
      } catch(_) {}
      try { sessionStorage.setItem('_curPos', JSON.stringify({x: mx, y: my})); } catch(_){}
      clearMag();
      // Match curtain to current page bg before fading out
      curtain.style.opacity = '';
      curtain.style.background = getComputedStyle(document.body).backgroundColor || '#0a0a0b';
      curtain.classList.remove('_in');
      curtain.classList.add('_out');
      setTimeout(() => { location.href = href; }, 195);
    });
  })();
})();
