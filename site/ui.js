// site/ui.js — Toro Math Lab front-end. Runs the bundled engine (site/engine.js).
// All artwork is procedural (layer-based vector shapes, one source rendered to
// both SVG and canvas). No external assets, no network calls.
/* global TORO */
(function () {
  'use strict';
  const T = TORO;
  const $ = (s) => document.querySelector(s);
  const TUNED = T.TUNED, SUMMARY = T.SUMMARY || {};

  // ---------------------------------------------------------------- helpers
  const fmt = (n) => Math.round(n).toLocaleString('en-AU');
  const fmtCur = (credits, denom) => (credits * denom).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (x, dp = 2) => (100 * x).toFixed(dp) + '%';

  // ---------------------------------------------------------------- artwork
  // Layers: {d,fill[,stroke,sw]} path | {c:[cx,cy,r],fill} | {t,x,y,s,fill[,w]}
  const HORN = '#e8b64c', HIDE = '#7a2e1d', HIDE2 = '#5c2115', WOOD = '#9c6b3f', WOOD2 = '#7a5230';
  const ART = {
    bull: [
      { d: 'M33 30 C22 28 14 20 12 9 C21 14 30 16 37 23 Z', fill: HORN },
      { d: 'M67 30 C78 28 86 20 88 9 C79 14 70 16 63 23 Z', fill: HORN },
      { d: 'M50 20 C41 20 34 25 31 32 L28 45 C26 58 33 70 42 76 L46 83 C48 86 52 86 54 83 L58 76 C67 70 74 58 72 45 L69 32 C66 25 59 20 50 20 Z', fill: HIDE },
      { d: 'M42 76 L46 83 C48 86 52 86 54 83 L58 76 C55 71 45 71 42 76 Z', fill: HIDE2 },
      { c: [41, 44, 3.5], fill: '#ffe9c9' }, { c: [59, 44, 3.5], fill: '#ffe9c9' },
      { c: [45, 70, 2.4], fill: '#3a130b' }, { c: [55, 70, 2.4], fill: '#3a130b' },
    ],
    gate: [
      { d: 'M18 24 h9 v56 h-9 Z', fill: WOOD }, { d: 'M73 24 h9 v56 h-9 Z', fill: WOOD },
      { d: 'M12 32 h76 v8 h-76 Z', fill: WOOD2 }, { d: 'M12 50 h76 v8 h-76 Z', fill: WOOD2 },
      { d: 'M12 68 h76 v8 h-76 Z', fill: WOOD2 },
      { d: 'M45 12 l5 -6 l5 6 l-2 8 h-6 Z', fill: HORN },
    ],
    coin: [
      { c: [50, 50, 38], fill: '#c9922a' }, { c: [50, 50, 33], fill: '#f5c542' },
      { c: [50, 50, 26], fill: '#ffd977' },
      { t: '$', x: 50, y: 63, s: 38, fill: '#8a5a10', w: 900 },
    ],
    horseshoe: [
      { d: 'M32 22 C20 34 18 52 27 66 C32 74 39 79 46 81 L49 71 C43 68 37 62 34 54 C31 44 34 34 41 28 Z', fill: HORN },
      { d: 'M68 22 C80 34 82 52 73 66 C68 74 61 79 54 81 L51 71 C57 68 63 62 66 54 C69 44 66 34 59 28 Z', fill: HORN },
      { c: [36, 30, 2.5], fill: '#8a5a10' }, { c: [64, 30, 2.5], fill: '#8a5a10' },
      { c: [30, 48, 2.5], fill: '#8a5a10' }, { c: [70, 48, 2.5], fill: '#8a5a10' },
      { c: [40, 70, 2.5], fill: '#8a5a10' }, { c: [60, 70, 2.5], fill: '#8a5a10' },
    ],
    cactus: [
      { d: 'M44 30 a6 6 0 0 1 12 0 v52 h-12 Z', fill: '#4e8f45' },
      { d: 'M26 42 a5 5 0 0 1 10 0 v10 a4 4 0 0 0 4 4 h4 v10 h-6 a12 12 0 0 1 -12 -12 Z', fill: '#437c3b' },
      { d: 'M74 36 a5 5 0 0 0 -10 0 v14 a4 4 0 0 1 -4 4 h-4 v10 h6 a12 12 0 0 0 12 -12 Z', fill: '#437c3b' },
      { c: [50, 24, 5], fill: '#e26d8f' },
      { d: 'M36 82 h28 v6 h-28 Z', fill: '#a97845' },
    ],
    mesa: [
      { c: [26, 26, 11], fill: '#f0b429' },
      { d: 'M10 74 L30 38 H70 L90 74 Z', fill: '#a04b2b' },
      { d: 'M24 74 L38 52 H62 L76 74 Z', fill: '#c26436' },
      { d: 'M8 74 h84 v6 h-84 Z', fill: '#6d3520' },
    ],
  };
  const ROYAL_COLORS = { A: '#e2504c', K: '#4c9de2', Q: '#b45ce0', J: '#4cc07a', '10': '#e0a23c', 9: '#8fa2b5' };
  function royalArt(letter) {
    return [
      { d: 'M22 14 h56 a8 8 0 0 1 8 8 v56 a8 8 0 0 1 -8 8 h-56 a8 8 0 0 1 -8 -8 v-56 a8 8 0 0 1 8 -8 Z', fill: '#241a15' },
      { d: 'M25 18 h50 a6 6 0 0 1 6 6 v52 a6 6 0 0 1 -6 6 h-50 a6 6 0 0 1 -6 -6 v-52 a6 6 0 0 1 6 -6 Z', fill: '#2f2820' },
      { t: letter, x: 50, y: 66, s: letter === '10' ? 38 : 46, fill: ROYAL_COLORS[letter], w: 900 },
    ];
  }
  for (const L of ['A', 'K', 'Q', 'J', '10', '9']) ART['royal' + L] = royalArt(L);
  ART.moneybull = [{ c: [50, 50, 44], fill: '#c9922a' }, { c: [50, 50, 39], fill: '#f5c542' }]
    .concat(ART.bull.map((l) => l.d ? { ...l } : { ...l }));
  ART.collector = ART.moneybull.map((l) => l.fill === HIDE ? { ...l, fill: '#a33d16' } : { ...l });
  ART.diamond = [{ d: 'M50 6 L82 38 L50 94 L18 38 Z', fill: '#3d6b8f' }, { d: 'M50 14 L74 38 L50 84 L26 38 Z', fill: '#7ec8ff' }]
    .concat(ART.bull.map((l) => ({ ...l })));

  function svgFor(kind) {
    const layers = ART[kind] || [];
    let out = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
    for (const l of layers) {
      if (l.d) out += `<path d="${l.d}" fill="${l.fill}"/>`;
      else if (l.c) out += `<circle cx="${l.c[0]}" cy="${l.c[1]}" r="${l.c[2]}" fill="${l.fill}"/>`;
      else if (l.t !== undefined) out += `<text x="${l.x}" y="${l.y}" font-size="${l.s}" font-weight="${l.w || 700}" fill="${l.fill}" text-anchor="middle" font-family="system-ui,sans-serif">${l.t}</text>`;
    }
    return out + '</svg>';
  }
  function paintSymbol(ctx, kind, x, y, size) {
    const layers = ART[kind] || [];
    const k = size / 100;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    for (const l of layers) {
      if (l.d) { ctx.fillStyle = l.fill; ctx.fill(new Path2D(l.d)); }
      else if (l.c) { ctx.fillStyle = l.fill; ctx.beginPath(); ctx.arc(l.c[0], l.c[1], l.c[2], 0, 7); ctx.fill(); }
      else if (l.t !== undefined) {
        ctx.fillStyle = l.fill; ctx.font = `${l.w || 700} ${l.s}px system-ui,sans-serif`;
        ctx.textAlign = 'center'; ctx.fillText(l.t, l.x, l.y);
      }
    }
    ctx.restore();
  }

  // Symbol id -> art kind, per model.
  const ART_A = ['bull', 'gate', 'coin', 'horseshoe', 'cactus', 'mesa', 'royalA', 'royalK', 'royalQ', 'royalJ', 'royal10', 'royal9'];
  const ART_B = ['bull', 'moneybull', 'horseshoe', 'cactus', 'mesa', 'royalA', 'royalK', 'royalQ', 'royalJ', 'royal10', 'royal9'];

  // ---------------------------------------------------------------- machine
  const canvas = $('#reelCanvas'), ctx = canvas.getContext('2d');
  const CW = 126, CH = 112, GX = 8, GY = 8, PAD = 10;
  canvas.width = PAD * 2 + CW * 5 + GX * 4;   // 682
  canvas.height = PAD * 2 + CH * 3 + GY * 2;  // 372

  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const rngPlay = T.mulberry32(seed);
  const mA = T.makeModelA(TUNED.A.coinWeights, TUNED.A.silverWeights);
  const mB = T.makeModelB(TUNED.B.coinWeights);
  const accA = T.makeAccA(), accB = T.makeAccB();

  const state = { model: 'A', denom: 0.01, balance: 100000, turbo: false, busy: false, win: 0 };

  const cellXY = (r, row) => [PAD + r * (CW + GX), PAD + row * (CH + GY)];
  const reelsOf = () => state.model === 'A' ? mA.base : mB.reels;
  const artOf = () => state.model === 'A' ? ART_A : ART_B;

  // Current display state.
  let dispStops = [0, 12, 24, 36, 48];
  let dispReels = null; // reel set the display corresponds to (base vs free)
  let cellBadges = {};  // cellKey (r*3+row) -> text badge (coin/silver values)
  let winLines = [];    // [{line, win}]

  function drawWindow(reels, stops, art) {
    ctx.fillStyle = '#120c09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < 5; r++) {
      for (let row = 0; row < 3; row++) {
        const [x, y] = cellXY(r, row);
        ctx.fillStyle = (r + row) % 2 ? '#1b130e' : '#1e150f';
        ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 8); ctx.fill();
        const sym = reels[r].win[stops[r] * 3 + row];
        const sz = Math.min(CW, CH) - 14;
        paintSymbol(ctx, art[sym], x + (CW - sz) / 2, y + (CH - sz) / 2, sz);
        const badge = cellBadges[r * 3 + row];
        if (badge) {
          ctx.fillStyle = 'rgba(20,12,6,.85)';
          ctx.beginPath(); ctx.roundRect(x + 12, y + CH - 30, CW - 24, 24, 12); ctx.fill();
          ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#ffd977'; ctx.font = '800 15px system-ui,sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(badge, x + CW / 2, y + CH - 12);
        }
      }
    }
    // Winning-line overlays (up to 8).
    const colors = ['#f0b429', '#e2504c', '#4c9de2', '#4cc07a', '#b45ce0', '#e0a23c', '#7ec8ff', '#e26d8f'];
    winLines.slice(0, 8).forEach((wl, i) => {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.8; ctx.lineWidth = 3.5; ctx.beginPath();
      T.LINES[wl.line].forEach((row, r) => {
        const [x, y] = cellXY(r, row);
        const cx = x + CW / 2, cy = y + CH / 2;
        if (r === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke(); ctx.globalAlpha = 1;
    });
  }

  function redraw() { drawWindow(dispReels || reelsOf(), dispStops, artOf()); }

  async function animateTo(reels, stops) {
    dispReels = reels;
    cellBadges = {}; winLines = [];
    if (state.turbo) { dispStops = stops.slice(); redraw(); await sleep(50); return; }
    const art = artOf();
    const t0 = performance.now();
    const durs = [320, 430, 540, 650, 760];
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = now - t0;
        ctx.fillStyle = '#120c09'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        let allDone = true;
        for (let r = 0; r < 5; r++) {
          const n = reels[r].n;
          const done = t >= durs[r];
          if (!done) allDone = false;
          const speed = 38; // strip positions per second-ish scroll feel
          const offset = done ? stops[r] : (stops[r] + (durs[r] - t) / 1000 * speed) % n;
          const base = Math.floor(offset), frac = offset - base;
          for (let row = -1; row < 3; row++) {
            const sym = reels[r].strip[((base + row) % n + n) % n];
            const [x, y0] = cellXY(r, 0);
            const y = y0 + (row - frac) * (CH + GY);
            if (y < -CH || y > canvas.height) continue;
            const sz = Math.min(CW, CH) - 14;
            paintSymbol(ctx, art[sym], x + (CW - sz) / 2, y + (CH - sz) / 2, sz);
          }
        }
        if (allDone) { dispStops = stops.slice(); redraw(); resolve(); }
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // UI bits ------------------------------------------------------------------
  const log = (html, big = false) => {
    const p = document.createElement('p');
    if (big) p.className = 'big';
    p.innerHTML = html;
    const el = $('#eventLog');
    el.prepend(p);
    while (el.children.length > 40) el.lastChild.remove();
  };
  function updateMeters() {
    $('#balanceCr').textContent = fmt(state.balance);
    $('#balanceCur').textContent = fmtCur(state.balance, state.denom);
    $('#betCur').textContent = fmtCur(30, state.denom);
    $('#winCr').textContent = fmt(state.win);
    $('#winCur').textContent = fmtCur(state.win, state.denom);
  }
  async function flashMsg(html, ms = 1400) {
    const m = $('#msgOverlay');
    m.innerHTML = html;
    m.classList.remove('hidden');
    await sleep(state.turbo ? Math.min(ms, 350) : ms);
    m.classList.add('hidden');
  }

  function findWinLines(reels, stops, PAY, BEST, WILD) {
    const out = [];
    for (let l = 0; l < T.N_LINES; l++) {
      const rows = T.LINES[l];
      const w = T.lineWin5(PAY, BEST, WILD,
        reels[0].win[stops[0] * 3 + rows[0]], reels[1].win[stops[1] * 3 + rows[1]],
        reels[2].win[stops[2] * 3 + rows[2]], reels[3].win[stops[3] * 3 + rows[3]],
        reels[4].win[stops[4] * 3 + rows[4]]);
      if (w > 0) out.push({ line: l, win: w });
    }
    return out;
  }
  const cellsWith = (reels, stops, sym) => {
    const cells = [];
    for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) {
      if (reels[r].win[stops[r] * 3 + row] === sym) cells.push(r * 3 + row);
    }
    return cells;
  };

  // One presented spin of Model A (base or free). Returns copied result.
  async function presentSpinA(isFree) {
    const detail = { coinIdx: [], silverIdx: [] };
    const sp = mA.spin(rngPlay, isFree, accA, detail);
    const res = { line: sp.line, scatters: sp.scatters, bulls: sp.bulls, coins: sp.coins, collect: sp.collect, silver: sp.silver, scatterPay: sp.scatterPay };
    const reels = isFree ? mA.free : mA.base;
    await animateTo(reels, detail.stops);
    if (res.line > 0) {
      winLines = findWinLines(reels, detail.stops, T.A_PAY, T.A_BEST, T.A.W);
      redraw();
    }
    if (res.bulls >= 2) {
      const coinCells = cellsWith(reels, detail.stops, T.A.C);
      const bullCells = cellsWith(reels, detail.stops, T.A.W);
      let sum = 0;
      detail.coinIdx.forEach((k, i) => {
        const label = T.COIN_LABELS[k];
        sum += T.COIN_VALUES[k];
        if (coinCells[i] !== undefined) cellBadges[coinCells[i]] = label ? label : fmt(T.COIN_VALUES[k]);
      });
      redraw();
      await flashMsg(`CHARGE HIT!<small>${res.bulls} Bulls &times; ${fmt(sum)} coin credits = <b>${fmt(res.collect)}</b></small>`, 1500);
      detail.silverIdx.forEach((k, i) => {
        const label = T.COIN_LABELS[k];
        if (bullCells[i] !== undefined) cellBadges[bullCells[i]] = (label ? label + ' ' : '+') + fmt(T.COIN_VALUES[k]);
      });
      redraw();
      await flashMsg(`SILVER REVEAL<small>Bulls transform: +${fmt(res.silver)} credits</small>`, 1200);
      log(`Charge Hit: ${res.bulls} Bulls collected ${fmt(sum)} twice-over &rarr; <b>${fmt(res.collect)}</b>cr, silver +<b>${fmt(res.silver)}</b>cr`, true);
    }
    return res;
  }

  async function playRoundA() {
    const b = await presentSpinA(false);
    let total = b.line + b.scatterPay + b.collect + b.silver;
    state.win += total; state.balance += total; updateMeters();
    if (b.line > 0) log(`Line wins: <b>${fmt(b.line)}</b>cr on ${winLines.length} line(s)`);
    if (b.scatters >= 3) {
      const n = T.A_FREE_N[Math.min(b.scatters, 5)];
      log(`${b.scatters} Gates &rarr; <b>${n} free games</b> + ${fmt(b.scatterPay)}cr scatter pay`, true);
      await flashMsg(`${b.scatters} GATES<small>${n} FREE GAMES + ${fmt(b.scatterPay)}cr</small>`, 1600);
      let pending = n, played = 0, freeTotal = 0;
      while (pending > 0 && played < T.A_MAX_FREE_SPINS) {
        pending--; played++;
        $('#msgOverlay').classList.add('hidden');
        const f = await presentSpinA(true);
        const w = f.line + f.scatterPay + f.collect + f.silver;
        freeTotal += w; state.win += w; state.balance += w; updateMeters();
        if (f.scatters >= 3) {
          const extra = T.A_FREE_N[Math.min(f.scatters, 5)];
          pending += extra;
          log(`Retrigger! ${f.scatters} Gates &rarr; +${extra} games`, true);
        }
        await flashMsg(`FREE GAME ${played}<small>${pending} left &middot; feature win ${fmt(freeTotal)}cr</small>`, state.turbo ? 120 : 700);
      }
      log(`Free games over: ${played} spins for <b>${fmt(freeTotal)}</b>cr`, true);
      dispReels = mA.base;
    }
  }

  // Model B round with Hold & Respin presentation.
  async function playRoundB() {
    const reels = mB.reels;
    const stops = [];
    let m = 0;
    for (let r = 0; r < 5; r++) {
      const st = (rngPlay() * reels[r].n) | 0;
      stops.push(st);
      m += mB.mcnt[r][st];
    }
    const lineWin = T.evalAllLines(reels, stops, T.B_PAY, T.B_BEST, T.B.W);
    await animateTo(reels, stops);
    if (lineWin > 0) {
      winLines = findWinLines(reels, stops, T.B_PAY, T.B_BEST, T.B.W);
      redraw();
      log(`Line wins: <b>${fmt(lineWin)}</b>cr on ${winLines.length} line(s)`);
    }
    state.win += lineWin; state.balance += lineWin; updateMeters();
    if (m >= T.B_TRIGGER) {
      const initCells = [];
      for (let r = 0; r < 5; r++) {
        const b = stops[r] * 3;
        for (let row = 0; row < 3; row++) if (reels[r].win[b + row] === T.B.M) initCells.push(r * 3 + row);
      }
      const det = { init: [], events: [] };
      const f = mB.playFeature(rngPlay, initCells, mB.realDraw, accB, det);
      log(`${m} Money Bulls &rarr; <b>HOLD &amp; RESPIN</b>`, true);
      await presentFeatureB(det, f);
      state.win += f.win; state.balance += f.win; updateMeters();
      log(`Hold &amp; Respin paid <b>${fmt(f.win)}</b>cr${f.grand ? ' including the GRAND (' + f.grandBy + ')' : ''}`, true);
    }
  }

  async function presentFeatureB(det, f) {
    const ov = $('#featureOverlay');
    ov.classList.remove('hidden');
    const cellEls = [], extraEls = [];
    let extraCount = 0;
    const render = () => {
      ov.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'fhead'; head.id = 'fhead';
      head.textContent = 'HOLD & RESPIN — 3 RESPINS';
      const sub = document.createElement('div');
      sub.className = 'fsub'; sub.id = 'fsub'; sub.textContent = 'Any new prize resets respins to 3';
      const board = document.createElement('div'); board.className = 'fboard';
      for (let i = 0; i < 15; i++) {
        // grid cell i = col*3+row; render row-major
        const row = Math.floor(i / 5), col = i % 5;
        const cell = document.createElement('div');
        cell.className = 'fcell';
        cell.dataset.key = col * 3 + row;
        board.appendChild(cell);
        cellEls[col * 3 + row] = cell;
      }
      const extraRow = document.createElement('div'); extraRow.className = 'fboard'; extraRow.id = 'fextra';
      ov.append(head, sub, board, extraRow);
    };
    render();
    const tick = state.turbo ? 60 : 380;
    for (const { cell, v } of det.init) {
      cellEls[cell].classList.add('filled');
      cellEls[cell].textContent = fmt(v);
    }
    await sleep(tick * 2);
    let phase = 1;
    for (const ev of det.events) {
      if (ev.respin) {
        $('#fhead').textContent = (phase === 2 ? 'STAMPEDE PHASE — ' : 'HOLD & RESPIN — ') + ev.left + ' RESPIN' + (ev.left === 1 ? '' : 'S') + ' LEFT';
        await sleep(state.turbo ? 30 : 240);
        continue;
      }
      if (ev.phase === 2 && phase === 1) {
        phase = 2;
        $('#fhead').textContent = 'STAMPEDE PHASE';
        $('#fsub').textContent = 'Extra positions from Diamond Bulls are now live — cover every column for the GRAND';
        await sleep(tick * 2);
      }
      let el;
      if (ev.isExtra) {
        el = extraEls[ev.cell];
        if (!el) { // safety: placeholder should exist from the diamond that created it
          el = document.createElement('div'); el.className = 'fcell';
          el.style.gridColumn = ev.col + 1;
          $('#fextra').appendChild(el);
          extraEls[ev.cell] = el;
        }
      } else el = cellEls[ev.cell];
      el.classList.add('filled', 'new');
      if (ev.type === 'collector') { el.classList.add('collector'); el.textContent = fmt(ev.v); }
      else if (ev.type === 'diamond') {
        el.classList.add('diamond'); el.textContent = fmt(ev.v);
        // Mirror the engine: each diamond adds one extra slot (up to the cap),
        // registered in landing order so extra-landing event indices line up.
        if (extraCount < T.B_FEAT.maxExtra) {
          const slot = document.createElement('div');
          slot.className = 'fcell';
          slot.style.gridColumn = ev.col + 1;
          $('#fextra').appendChild(slot);
          extraEls[extraCount] = slot;
          extraCount++;
        }
      } else el.textContent = fmt(ev.v);
      if (ev.type === 'collector') $('#fsub').textContent = `Collector Bull collects everything revealed: ${fmt(ev.v)} credits — and sticks`;
      await sleep(tick);
      el.classList.remove('new');
    }
    if (f.grand) {
      await flashMsg(`GRAND!<small>${fmt(T.B_GRAND)} credits — ${f.grandBy === 'fill' ? 'all 15 positions filled' : 'every column hit in the Stampede phase'}</small>`, 2200);
    }
    await flashMsg(`FEATURE PAYS<small><b>${fmt(f.win)}</b> credits</small>`, 1600);
    ov.classList.add('hidden');
  }

  async function doSpin() {
    if (state.busy) return;
    state.busy = true;
    $('#spinBtn').disabled = true;
    try {
      if (state.balance < 30) {
        state.balance += 100000;
        log('Demo balance topped up (+100,000 credits — they are free and worthless).');
      }
      state.balance -= 30;
      state.win = 0;
      updateMeters();
      if (state.model === 'A') await playRoundA(); else await playRoundB();
      updateMeters();
    } finally {
      state.busy = false;
      $('#spinBtn').disabled = false;
    }
  }

  // ---------------------------------------------------------------- controls
  $('#spinBtn').addEventListener('click', doSpin);
  $('#turboBtn').addEventListener('click', () => {
    state.turbo = !state.turbo;
    $('#turboBtn').classList.toggle('on', state.turbo);
    $('#turboState').textContent = state.turbo ? 'on' : 'off';
  });
  document.querySelectorAll('#modelTabs .tab').forEach((b) => b.addEventListener('click', () => {
    if (state.busy) return;
    document.querySelectorAll('#modelTabs .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.model = b.dataset.model;
    dispReels = null; cellBadges = {}; winLines = [];
    redraw();
    log(`Switched to <b>${state.model === 'A' ? 'Golden Charge' : 'Thunder Herd'}</b>`);
  }));
  {
    const sel = $('#denomSel');
    for (const d of T.DENOMS) {
      const o = document.createElement('option');
      o.value = d; o.textContent = (d * 100) + 'c';
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { state.denom = Number(sel.value); updateMeters(); });
  }

  // ---------------------------------------------------------------- tables
  // numCols: indices that hold pure numbers/percentages (right-aligned, tabular
  // mono). Columns carrying sentences or mixed text+number strings stay in
  // body type, left-aligned — only true data columns get the meter treatment.
  function tableHTML(headers, rows, numCols = []) {
    const isNum = new Set(numCols);
    let h = '<div class="gen-table"><table><thead><tr>';
    for (const x of headers) h += `<th>${x}</th>`;
    h += '</tr></thead><tbody>';
    for (const row of rows) {
      h += '<tr>';
      row.forEach((cell, i) => { h += `<td class="${isNum.has(i) ? 'num' : ''}">${cell}</td>`; });
      h += '</tr>';
    }
    return h + '</tbody></table></div>';
  }
  const symCell = (kind, name) => `<span class="sym-cell">${svgFor(kind)}<span>${name}</span></span>`;

  {
    const rows = [];
    const order = [[T.A.H1, 'horseshoe'], [T.A.H2, 'cactus'], [T.A.H3, 'mesa'], [T.A.AA, 'royalA'], [T.A.KK, 'royalK'], [T.A.QQ, 'royalQ'], [T.A.JJ, 'royalJ'], [T.A.TT, 'royal10'], [T.A.NN, 'royal9']];
    for (const [sym, kind] of order) {
      rows.push([symCell(kind, T.A_NAMES[sym].replace(/ ?\(.*\)/, '')), T.A_PAY[sym * 6 + 3], T.A_PAY[sym * 6 + 4], T.A_PAY[sym * 6 + 5]]);
    }
    $('#payTable').innerHTML = tableHTML(['Symbol', '3 of a kind', '4 of a kind', '5 of a kind'], rows, [1, 2, 3]);

    $('#specialTable').innerHTML = tableHTML(['Symbol', 'Behaviour'], [
      [symCell('bull', 'Bull (wild)'), 'Golden Charge: substitutes for all paying symbols; 2+ visible fire a Charge Hit'],
      [symCell('gate', 'Ranch Gate (scatter)'), '3 / 4 / 5 anywhere pay 2&times; / 10&times; / 100&times; bet and start 15 / 20 / 25 free games'],
      [symCell('coin', 'Gold Coin'), 'Carries a credit value or jackpot label; collected by Bulls during a Charge Hit'],
      [symCell('moneybull', 'Money Bull'), 'Thunder Herd: carries a value; 6+ start Hold &amp; Respin'],
      [symCell('collector', 'Collector Bull'), 'Feature only: arrives holding the sum of every revealed prize, then sticks'],
      [symCell('diamond', 'Diamond Bull'), 'Feature only: normal prize that adds one extra Stampede-phase position'],
    ]);

    const wsum = (w) => w.reduce((a, b) => a + b, 0);
    const wa = TUNED.A.coinWeights, ws = TUNED.A.silverWeights, wb = TUNED.B.coinWeights;
    const [ta, ts, tb] = [wsum(wa), wsum(ws), wsum(wb)];
    const coinRows = T.COIN_VALUES.map((v, i) => [
      (T.COIN_LABELS[i] ? `<b>${T.COIN_LABELS[i]}</b> — ` : '') + fmt(v) + 'cr',
      pct(wa[i] / ta, 2), pct(ws[i] / ts, 2), wb[i] ? pct(wb[i] / tb, 2) : '—',
    ]);
    $('#coinTable').innerHTML = tableHTML(['Value', 'Gold Coin (A)', 'Silver reveal (A)', 'Money Bull (B)'], coinRows, [1, 2, 3]) +
      `<p class="note">Weights are the tuned draw probabilities. Mean values: Gold Coin ${TUNED.A.muCoin.toFixed(1)}cr,
       silver ${TUNED.A.muSilver.toFixed(1)}cr, Money Bull ${TUNED.B.muCoin.toFixed(1)}cr. The GRAND label appears only
       on Golden Charge coins; Thunder Herd's GRAND is won on the board.</p>`;
  }

  // Model comparison from validation summary.
  {
    const a = SUMMARY.A, b = SUMMARY.B;
    const rows = [
      ['Mechanic', 'Wild collector + free games', 'Hold &amp; respin (6+ trigger)'],
      ['Target RTP', '96.09%', '96.10%'],
      ['Exact / solved RTP', a ? pct(a.exactRTP, 4) : '—', b ? pct(b.exactRTP, 4) : '—'],
      ['Measured RTP', a ? `${pct(a.measuredRTP, 3)} <small>(${(a.spins / 1e6)}M spins)</small>` : '—', b ? `${pct(b.measuredRTP, 3)} <small>(${(b.spins / 1e6)}M spins)</small>` : '—'],
      ['Hit rate', a ? pct(a.hitRate) : '—', b ? pct(b.hitRate) : '—'],
      ['Volatility index (SD of spin multiple)', a ? a.volatilityIndex.toFixed(2) : '—', b ? b.volatilityIndex.toFixed(2) : '—'],
      ['Main feature frequency', a ? '1 in ' + a.freeFreq.toFixed(0) + ' (free games)' : '—', b ? '1 in ' + b.featureFreq.toFixed(0) + ' (hold &amp; respin)' : '—'],
      ['Collect events', a ? '1 in ' + a.chargeHitFreq.toFixed(0) + ' spins (base Charge Hit)' : '—', 'every feature (bull values)'],
      ['GRAND (1000&times; bet)', 'silver-coin reveal (very rare)', b && b.grandFreq ? '1 in ' + fmt(b.grandFreq) + ' spins' : '—'],
      ['Largest win seen in validation', a ? a.maxWinMultiple.toFixed(0) + '&times; bet' : '—', b ? b.maxWinMultiple.toFixed(0) + '&times; bet' : '—'],
      ['Longest dead run seen', a ? a.deadMax + ' spins' : '—', b ? b.deadMax + ' spins' : '—'],
    ];
    $('#compareTable').innerHTML = tableHTML(['', 'GOLDEN CHARGE', 'THUNDER HERD'], rows);
  }

  // ---------------------------------------------------------------- worked examples
  function buildWorked(container, spec) {
    const root = $(container);
    root.innerHTML = `<div class="wgrid"></div><div class="wextra"></div><div class="narr"></div>
      <div class="wbtns"><button data-nav="-1">&larr; Back</button><button data-nav="1">Next &rarr;</button></div>
      <div class="wstep"></div>`;
    const grid = root.querySelector('.wgrid'), extra = root.querySelector('.wextra');
    const cells = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
      const c = document.createElement('div');
      c.className = 'wcell';
      grid.appendChild(c);
      cells[col * 3 + row] = c;
    }
    let step = 0;
    const renderStep = () => {
      const s = spec.steps[step];
      extra.innerHTML = '';
      cells.forEach((c, key) => {
        const cs = s.cells[key];
        c.className = 'wcell' + (cs && cs.hl ? ' hl' : '') + (!cs ? ' dim' : '');
        c.innerHTML = cs ? svgFor(cs.k) + (cs.v !== undefined ? `<span class="val">${cs.v}</span>` : '') : svgFor(spec.filler[key % spec.filler.length]);
      });
      for (const e of s.extra || []) {
        const c = document.createElement('div');
        c.className = 'wcell' + (e.hl ? ' hl' : '');
        c.style.gridColumn = e.col + 1;
        c.innerHTML = (e.k ? svgFor(e.k) : '') + (e.v !== undefined ? `<span class="val">${e.v}</span>` : '');
        extra.appendChild(c);
      }
      root.querySelector('.narr').innerHTML = s.narr;
      root.querySelector('.wstep').textContent = `Step ${step + 1} of ${spec.steps.length}`;
      root.querySelector('[data-nav="-1"]').disabled = step === 0;
      root.querySelector('[data-nav="1"]').disabled = step === spec.steps.length - 1;
    };
    root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      step = Math.max(0, Math.min(spec.steps.length - 1, step + Number(b.dataset.nav)));
      renderStep();
    }));
    renderStep();
  }

  // Worked example A: 2 bulls, coins 60+90+150.
  {
    const bull = (hl) => ({ k: 'bull', hl });
    const coin = (v, hl) => ({ k: 'coin', v, hl });
    const base = { 0: coin('?'), 8: coin('?'), 13: coin('?'), 4: bull(), 10: bull() };
    // cell keys: col*3+row. coin cells: c0r0=0, c2r2=8, c4r1=13; bulls c1r1=4, c3r1=10.
    const withVals = { 0: coin(60), 8: coin(90), 13: coin(150), 4: bull(), 10: bull() };
    buildWorked('#workedA', {
      filler: ['royal9', 'royal10', 'royalJ', 'royalQ', 'royalK'],
      steps: [
        { cells: base, narr: 'A paid spin lands <b>2 Bulls</b> and <b>3 Gold Coins</b>. Two or more Bulls means a Charge Hit fires.' },
        { cells: withVals, narr: 'The coins reveal their values: <b>60 + 90 + 150 = 300</b> credits on screen.' },
        { cells: { ...withVals, 4: bull(true) }, narr: 'Bull #1 collects the <b>full</b> coin sum: <b>+300</b> credits.' },
        { cells: { ...withVals, 10: bull(true) }, narr: 'Bull #2 <em>also</em> collects the full sum: <b>+300</b> more — the whole sum is paid once per Bull. Running total: <b>600</b>.' },
        {
          cells: { 0: coin(60), 8: coin(90), 13: coin(150), 4: { k: 'coin', v: '+90', hl: true }, 10: { k: 'coin', v: 'MINI', hl: true } },
          narr: 'Each Bull then transforms into a silver coin: here <b>+90</b> and the <b>MINI (300)</b>. Feature total: 300 + 300 + 90 + 300 = <b>990 credits</b> — plus any line wins from the same spin.',
        },
      ],
    });
  }

  // Worked example B: stampede walkthrough (values chosen for arithmetic clarity).
  {
    const mb = (v, hl, k = 'moneybull') => ({ k, v, hl });
    const init = { 0: mb(30), 4: mb(60), 6: mb(90), 8: mb(120), 10: mb(150), 14: mb(200) };
    buildWorked('#workedB', {
      filler: ['royal9', 'royal10', 'royalJ', 'royalQ', 'royalK'],
      steps: [
        { cells: init, narr: '<b>6 Money Bulls</b> (30+60+90+120+150+200 = <b>650</b>cr revealed) lock in place. Hold &amp; Respin starts with <b>3 respins</b>.' },
        { cells: { ...init, 3: mb(40, true), 9: mb(60, true) }, narr: 'Respin 1: two new prizes land (<b>40</b> and <b>60</b>). Revealed total: <b>750</b>. Respins reset to <b>3</b>.' },
        { cells: { ...init, 3: mb(40), 9: mb(60), 2: mb(750, true, 'collector') }, narr: 'A <b>Collector Bull</b> lands. It collects everything revealed — <b>750</b> credits — and sticks as a 750 prize. Revealed total: <b>1,500</b>.' },
        { cells: { ...init, 3: mb(40), 9: mb(60), 2: mb(750, false, 'collector'), 12: mb(50, true, 'diamond') }, extra: [{ col: 4, v: '', k: undefined }], narr: 'A <b>Diamond Bull</b> lands for <b>50</b> and adds one <b>extra position</b> under its column, to be played after the main grid settles. Total: <b>1,550</b>.' },
        { cells: { ...init, 3: mb(40), 9: mb(60), 2: mb(750, false, 'collector'), 12: mb(50, false, 'diamond') }, extra: [{ col: 4, v: '', hl: true }], narr: 'Three respins pass with nothing new — the main phase ends. The <b>Stampede phase</b> begins on the extra position (and any still-empty main cells), respins reset to 3.' },
        { cells: { ...init, 3: mb(40), 9: mb(60), 2: mb(750, false, 'collector'), 12: mb(50, false, 'diamond') }, extra: [{ col: 4, v: 120, k: 'moneybull', hl: true }], narr: 'The extra position lands <b>120</b>. Only one column got a Stampede-phase prize, so no GRAND this time. Feature total: 650 + 100 + 750 + 50 + 120 = <b>1,670 credits</b>.' },
      ],
    });
  }

  // ---------------------------------------------------------------- FAQ
  {
    const faqs = [
      ['What is this project?', 'A private mathematics study of two common pokie architectures: a wild-collector game and a hold-&-respin game. We built both as complete engines, tuned them to precise return targets with exact combinatorics, and validated them with large Monte Carlo runs. The site is the write-up; the demo is the actual engine.'],
      ['Is this gambling?', 'No. The demo plays with free, valueless credits. Nothing can be deposited, wagered, won, or bought, and the project is not connected to any casino, real or online.'],
      ['What does RTP mean?', 'Return To Player: the long-run average share of turnover a game pays back. Both models here are tuned to about 96.1%. Over any short session the result is dominated by variance — that is what the volatility index measures.'],
      ['What is the volatility index shown in the comparison?', 'The standard deviation of a single spin’s outcome, in bet multiples. Around 9 for Golden Charge and 12–13 for Thunder Herd — the second model concentrates more of its return into rare, large feature payouts.'],
      ['How were the models tuned?', 'Everything except the coin-value distributions is fixed design (strips, pays, feature rules). The return is then a linear function of the coin means, so the tuner solves for the exact mean the target requires and re-weights a fixed value list to that mean. For Thunder Herd the feature’s structure coefficient was estimated from 16 million simulated features first.'],
      ['How is the GRAND won in Thunder Herd?', 'Two ways: fill all 15 main grid positions in either phase, or land at least one prize in every column during the Stampede phase. It pays 1,000× the total bet on top of the collected values.'],
      ['Why are there so many losing spins?', 'By design, matching the studied profile: both models keep hit rates near 33%, and Thunder Herd moves almost two-thirds of its return into a feature that hits about once every 121 spins. Long dead stretches are the price of big feature payouts at a fixed RTP.'],
      ['Are these the odds of a real machine?', 'No. They are original models built to publicly documented return targets and mechanic descriptions. Real machines’ internal PAR sheets are proprietary; no manufacturer data was used or reproduced.'],
      ['Can I use the code or the numbers?', 'The project is for research and education. The full source, tuning method, seeds, and validation reports are in the repository so every number on this page can be reproduced.'],
    ];
    $('#faqList').innerHTML = faqs.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('');
  }

  // ---------------------------------------------------------------- dashboard
  const dash = {
    model: 'A', running: false, spins: 0, winSum: 0, hits: 0, feats: 0, max: 0,
    grands: 0, jp: { MINI: 0, MINOR: 0, MEGA: 0, GRAND: 0 },
    rng: T.mulberry32((Date.now() * 7919) >>> 0),
    accA: T.makeAccA(), accB: T.makeAccB(), out: {},
    target: 0,
  };
  function dashReset() {
    dash.spins = 0; dash.winSum = 0; dash.hits = 0; dash.feats = 0; dash.max = 0; dash.grands = 0;
    dash.jp = { MINI: 0, MINOR: 0, MEGA: 0, GRAND: 0 };
    dash.accA = T.makeAccA(); dash.accB = T.makeAccB();
    $('#dashLog').innerHTML = '';
    dashRender();
  }
  function dashRender() {
    $('#dSpins').textContent = fmt(dash.spins);
    $('#dRtp').textContent = dash.spins ? pct(dash.winSum / (dash.spins * 30), 3) : '—';
    const solved = dash.model === 'A' ? TUNED.A.exactRTP : TUNED.B.solvedRTP;
    $('#dRtpRef').textContent = 'solved: ' + pct(solved, 3);
    $('#dHit').textContent = dash.spins ? pct(dash.hits / dash.spins) : '—';
    $('#dFeat').textContent = fmt(dash.feats);
    $('#dFeatFreq').textContent = dash.feats ? '1 in ' + (dash.spins / dash.feats).toFixed(0) : '';
    const jp = dash.model === 'A' ? dash.accA.jp : dash.accB.jp;
    $('#dJp').textContent = `${jp.MINI}/${jp.MINOR}/${jp.MEGA}` + (dash.model === 'A' ? `/${jp.GRAND}` : ` +${dash.grands}G`);
    $('#dMax').textContent = dash.max ? fmt(dash.max) + 'cr (' + (dash.max / 30).toFixed(0) + 'x)' : '—';
    $('#dashProg').style.width = dash.target ? Math.min(100, 100 * dash.spins / dash.target) + '%' : '0';
  }
  const dashLog = (html) => {
    const p = document.createElement('p');
    p.innerHTML = html;
    const el = $('#dashLog');
    el.prepend(p);
    while (el.children.length > 60) el.lastChild.remove();
  };
  function dashChunk() {
    if (!dash.running) return;
    const mdl = dash.model === 'A' ? mADash : mBDash;
    const acc = dash.model === 'A' ? dash.accA : dash.accB;
    for (let i = 0; i < 25000 && dash.spins < dash.target; i++) {
      mdl.playRound(dash.rng, dash.out, acc);
      const w = dash.out.win;
      dash.spins++; dash.winSum += w;
      if (w > 0) dash.hits++;
      if (w > dash.max) dash.max = w;
      if (dash.model === 'B' && dash.out.grand) { dash.grands++; dashLog(`<b>GRAND</b> hit on spin ${fmt(dash.spins)} — round paid ${fmt(w)}cr`); }
      if (w >= 3000) dashLog(`spin ${fmt(dash.spins)}: <b>${fmt(w)}cr</b> (${(w / 30).toFixed(0)}&times; bet)`);
    }
    dash.feats = dash.model === 'A' ? dash.accA.freeTrig : dash.accB.trig;
    dashRender();
    if (dash.spins >= dash.target) { dash.running = false; $('#dashRun').disabled = false; $('#dashStop').disabled = true; dashLog(`<b>done:</b> ${fmt(dash.spins)} spins, measured RTP ${pct(dash.winSum / (dash.spins * 30), 3)}`); return; }
    setTimeout(dashChunk, 0);
  }
  // Dashboard uses its own model instances so the demo machine's RNG is untouched.
  const mADash = T.makeModelA(TUNED.A.coinWeights, TUNED.A.silverWeights);
  const mBDash = T.makeModelB(TUNED.B.coinWeights);
  $('#dashRun').addEventListener('click', () => {
    dash.target = dash.spins + 1000000;
    dash.running = true;
    $('#dashRun').disabled = true; $('#dashStop').disabled = false;
    dashChunk();
  });
  $('#dashStop').addEventListener('click', () => { dash.running = false; $('#dashRun').disabled = false; $('#dashStop').disabled = true; });
  $('#dashReset').addEventListener('click', () => { dash.running = false; $('#dashRun').disabled = false; $('#dashStop').disabled = true; dashReset(); });
  document.querySelectorAll('#dashTabs .tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#dashTabs .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    dash.running = false; $('#dashRun').disabled = false; $('#dashStop').disabled = true;
    dash.model = b.dataset.model;
    dashReset();
  }));

  // ---------------------------------------------------------------- init
  updateMeters();
  redraw();
  dashRender();
  log('Welcome to the Toro Math Lab demo. Pick a model and spin — every result comes from the validated engines.');
})();
