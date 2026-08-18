// public/js/play.js — the play page client. Every spin OUTCOME is resolved
// server-side (server/routes/play.js -> server/engineBridge.js, which calls
// the real, unmodified models/modelA.js / modelB.js). This file only:
//   1. asks the server to resolve a round,
//   2. animates the result using the real reel strips (public/js/reeldata.js,
//      generated from the same model files — visuals only, never outcomes),
//   3. plays procedural audio and celebration effects timed to that replay.
// Reel index cannot decide credits; it can only decide how fast to *show* a
// result the server already committed to the ledger.
import { paintSymbol } from '/js/art.js';
import { REELDATA } from '/js/reeldata.js';
import { sound, wireAudioControls } from '/js/audio.js';

const $ = (s) => document.querySelector(s);
const CFG = window.WGC_PLAY;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

wireAudioControls(document);

// ---------------------------------------------------------------- state
const state = {
  model: CFG.modelAEnabled ? 'A' : 'B',
  totalBet: Math.max(CFG.minBet, Math.min(CFG.maxBet, CFG.baseBet)),
  balance: CFG.balance,
  turbo: false,
  busy: false,
  blocked: false,
  autoplay: { running: false, stop: false },
};

// ---------------------------------------------------------------- reel helpers
// A lightweight client-side mirror of core/engine.js's window lookup: given a
// strip and a stop index, the 3 visible symbols are strip[stop], strip[stop+1],
// strip[stop+2] (wrapping). This is pure presentation math over public data —
// it never decides which stop a reel lands on.
function windowAt(strip, stop) {
  const n = strip.length;
  return [strip[stop % n], strip[(stop + 1) % n], strip[(stop + 2) % n]];
}
function stripsFor(model, isFree) {
  const d = REELDATA[model];
  return model === 'A' ? (isFree ? d.freeStrips : d.baseStrips) : d.strips;
}
function artFor(model, symId) {
  return REELDATA[model].art[symId];
}

// ---------------------------------------------------------------- canvas
const canvas = $('#reelCanvas'), ctx = canvas.getContext('2d');
const coinCanvas = $('#coinCanvas'), cctx = coinCanvas.getContext('2d');
const CW = 126, CH = 112, GX = 8, GY = 8, PAD = 10;
canvas.width = coinCanvas.width = PAD * 2 + CW * 5 + GX * 4;
canvas.height = coinCanvas.height = PAD * 2 + CH * 3 + GY * 2;
const cellXY = (r, row) => [PAD + r * (CW + GX), PAD + row * (CH + GY)];

let cellBadges = {};
function drawWindow(model, strips, stops) {
  ctx.fillStyle = '#1c0f06';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < 5; r++) {
    const win = windowAt(strips[r], stops[r]);
    for (let row = 0; row < 3; row++) {
      const [x, y] = cellXY(r, row);
      ctx.fillStyle = (r + row) % 2 ? '#2a1a0d' : '#301e10';
      ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(255,217,119,.18)'; ctx.lineWidth = 1; ctx.stroke();
      const sz = Math.min(CW, CH) - 14;
      paintSymbol(ctx, artFor(model, win[row]), x + (CW - sz) / 2, y + (CH - sz) / 2, sz);
      const badge = cellBadges[r * 3 + row];
      if (badge) {
        ctx.fillStyle = 'rgba(20,12,6,.85)';
        ctx.beginPath(); ctx.roundRect(x + 10, y + CH - 30, CW - 20, 24, 12); ctx.fill();
        ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#ffd977'; ctx.font = '800 14px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(badge, x + CW / 2, y + CH - 12);
      }
    }
  }
}

// Anticipation: reels 0-3 are already landed (we know the FULL result already
// — this is cosmetic pacing, not a second RNG draw), so if they're one strong
// symbol away from a feature we hold reel 5 a beat longer and glow the frame.
function computeAnticipation(model, strips, stops) {
  if (stops.length < 5) return false;
  const targetSym = model === 'A' ? REELDATA.A.S : REELDATA.B.M;
  let count = 0;
  for (let r = 0; r < 4; r++) count += windowAt(strips[r], stops[r]).filter((s) => s === targetSym).length;
  return model === 'A' ? count >= 2 : count >= 4;
}

async function animateTo(model, isFree, stops, { anticipate = false } = {}) {
  const strips = stripsFor(model, isFree);
  const fast = state.turbo;
  const baseDurs = [300, 400, 500, 600, 720];
  const durs = baseDurs.map((d, i) => (fast ? d * 0.28 : d) + (anticipate && i === 4 ? (fast ? 260 : 650) : 0));
  canvas.classList.toggle('anticipate', anticipate);
  const t0 = performance.now();
  let lastTick = 0, stopped = [false, false, false, false, false];
  await new Promise((resolve) => {
    const frame = (now) => {
      const t = now - t0;
      ctx.fillStyle = '#1c0f06'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      let allDone = true;
      for (let r = 0; r < 5; r++) {
        const n = strips[r].length;
        const done = t >= durs[r];
        if (!done) allDone = false;
        else if (!stopped[r]) { stopped[r] = true; sound.reelStop(r); }
        const speed = fast ? 70 : 40;
        const offset = done ? stops[r] : (stops[r] + (durs[r] - t) / 1000 * speed) % n;
        const base = Math.floor(offset), frac = offset - base;
        for (let row = -1; row < 3; row++) {
          const sym = strips[r][((base + row) % n + n) % n];
          const [x, y0] = cellXY(r, 0);
          const y = y0 + (row - frac) * (CH + GY);
          if (y < -CH || y > canvas.height) continue;
          const sz = Math.min(CW, CH) - 14;
          paintSymbol(ctx, artFor(model, sym), x + (CW - sz) / 2, y + (CH - sz) / 2, sz);
        }
        if (anticipate && r === 4 && !done && t - lastTick > 160) { sound.anticipationTick(); lastTick = t; }
      }
      if (allDone) { canvas.classList.remove('anticipate'); drawWindow(model, strips, stops); resolve(); }
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------- coin shower
let coinParticles = [];
function spawnCoinShower(n) {
  for (let i = 0; i < n; i++) {
    coinParticles.push({
      x: Math.random() * coinCanvas.width, y: -20 - Math.random() * 200,
      vy: 2 + Math.random() * 3, vx: (Math.random() - 0.5) * 1.5,
      r: 6 + Math.random() * 5, spin: Math.random() * 6, spinV: (Math.random() - 0.5) * 0.3,
      life: 0, maxLife: 90 + Math.random() * 60,
    });
  }
  if (!coinShowerRAF) tickCoinShower();
}
let coinShowerRAF = null;
function tickCoinShower() {
  cctx.clearRect(0, 0, coinCanvas.width, coinCanvas.height);
  coinParticles.forEach((p) => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.spin += p.spinV; p.life++;
    cctx.save();
    cctx.translate(p.x, p.y); cctx.rotate(p.spin);
    cctx.fillStyle = '#f5c542'; cctx.strokeStyle = '#8a5a10'; cctx.lineWidth = 1.5;
    cctx.beginPath(); cctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); cctx.fill(); cctx.stroke();
    cctx.restore();
  });
  coinParticles = coinParticles.filter((p) => p.life < p.maxLife && p.y < coinCanvas.height + 40);
  if (coinParticles.length > 0) coinShowerRAF = requestAnimationFrame(tickCoinShower);
  else { coinShowerRAF = null; cctx.clearRect(0, 0, coinCanvas.width, coinCanvas.height); }
}

// ---------------------------------------------------------------- win banner + count-up
const winTiers = [
  { mult: 100, tier: 'jackpot', label: 'JACKPOT!' },
  { mult: 25, tier: 'mega', label: 'MEGA WIN' },
  { mult: 10, tier: 'big', label: 'BIG WIN' },
  { mult: 2, tier: 'nice', label: 'NICE WIN' },
];
const burstEl = $('#lightBurst');
const COIN_COUNT = { sparkle: 6, nice: 14, big: 30, mega: 55, jackpot: 100 };
function flashGlow(tier, ms) {
  canvas.classList.add('win-glow-' + tier);
  burstEl.className = 'burst-' + tier;
  spawnCoinShower(COIN_COUNT[tier] || 10);
  setTimeout(() => { canvas.classList.remove('win-glow-' + tier); burstEl.className = ''; }, ms);
}
async function celebrateWin(win, stake) {
  const ratio = win / stake;
  const hit = winTiers.find((t) => ratio >= t.mult);
  if (!hit) {
    // Every win gets *something* — a quick golden flash and a few sparkle
    // coins even below the "Nice Win" banner threshold, so a modest win
    // still visibly reads as a win rather than just a number changing.
    if (win > 0) flashGlow('sparkle', state.turbo ? 250 : 550);
    return;
  }
  const el = $('#winBanner');
  el.className = 'win-banner ' + hit.tier;
  el.querySelector('.txt').textContent = hit.label;
  sound.winBanner(hit.tier);
  const glowMs = state.turbo ? 400 : hit.tier === 'jackpot' ? 2400 : hit.tier === 'mega' ? 1800 : 1200;
  flashGlow(hit.tier, glowMs);
  await sleep(state.turbo ? 500 : hit.tier === 'jackpot' ? 2200 : 1500);
  el.classList.add('hidden');
}
async function countUpWin(from, to) {
  if (to <= from) { $('#winCr').textContent = fmt(to); return; }
  const dur = state.turbo ? 180 : Math.min(1600, 300 + (to - from) * 2);
  const t0 = performance.now();
  let lastTick = 0;
  await new Promise((resolve) => {
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      $('#winCr').textContent = fmt(v);
      if (now - lastTick > 60 && p < 1) { sound.balanceCountTick(); lastTick = now; }
      if (p < 1) requestAnimationFrame(frame); else { $('#winCr').textContent = fmt(to); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------- log + messages
const log = (html, big = false) => {
  const p = document.createElement('p');
  if (big) p.className = 'big';
  p.innerHTML = html;
  const el = $('#eventLog');
  el.prepend(p);
  while (el.children.length > 50) el.lastChild.remove();
};
async function flashMsg(html, ms) {
  const m = $('#msgOverlay');
  m.innerHTML = html;
  m.classList.remove('hidden');
  await sleep(state.turbo ? Math.min(ms, 300) : ms);
  m.classList.add('hidden');
}

// ---------------------------------------------------------------- Model A presentation
async function presentRoundA(round) {
  let runningWin = 0;
  const spins = round.events.filter((e) => e.kind === 'spin');
  let spinIdx = 0;
  for (const ev of round.events) {
    if (ev.kind === 'spin') {
      spinIdx++;
      cellBadges = {};
      const isFirst = spinIdx === 1;
      const strips = stripsFor('A', ev.isFree);
      const anticipate = isFirst && computeAnticipation('A', strips, ev.stops);
      await animateTo('A', ev.isFree, ev.stops, { anticipate });
      if (ev.line > 0) { sound.lineWin(ev.line > state.totalBet ? 1 : 0); log(`Line win: <b>${fmt(ev.line)}</b>cr`); }
      runningWin += ev.line + ev.scatterPay + ev.collect + ev.silver;
      await countUpWin(runningWin - (ev.line + ev.scatterPay + ev.collect + ev.silver), runningWin);
      if (ev.bulls >= 2) {
        const coinCells = [], bullCells = [];
        for (let r = 0; r < 5; r++) {
          const w = windowAt(strips[r], ev.stops[r]);
          w.forEach((s, row) => { if (s === REELDATA.A.C) coinCells.push(r * 3 + row); if (s === REELDATA.A.W) bullCells.push(r * 3 + row); });
        }
        sound.chargeHit();
        ev.coins.forEach((c, i) => { setTimeout(() => sound.coinCollect(), i * 45); if (coinCells[i] !== undefined) cellBadges[coinCells[i]] = c.label || fmt(c.value); });
        drawWindow('A', strips, ev.stops);
        const coinSum = ev.coins.reduce((s, c) => s + c.value, 0);
        await flashMsg(`CHARGE HIT!<small>${ev.bulls} Bulls &times; ${fmt(coinSum)} coin credits = <b>${fmt(ev.collect)}</b></small>`, 1500);
        sound.silverReveal();
        ev.silverReveals.forEach((c, i) => { if (bullCells[i] !== undefined) cellBadges[bullCells[i]] = (c.label ? c.label + ' ' : '+') + fmt(c.value); });
        drawWindow('A', strips, ev.stops);
        await flashMsg(`SILVER REVEAL<small>Bulls transform: +${fmt(ev.silver)} credits</small>`, 1200);
        log(`Charge Hit: ${ev.bulls} Bulls &times; ${fmt(coinSum)} &rarr; <b>${fmt(ev.collect)}</b>cr, silver +<b>${fmt(ev.silver)}</b>cr`, true);
      }
    } else if (ev.kind === 'free_trigger') {
      sound.featureTrigger();
      log(`${ev.scatters} Ranch Gates &rarr; <b>${ev.granted} free games</b>`, true);
      await flashMsg(`${ev.scatters} GATES<small>${ev.granted} FREE GAMES</small>`, 1600);
    } else if (ev.kind === 'retrigger') {
      sound.featureTrigger();
      log(`Retrigger! ${ev.scatters} Gates &rarr; +${ev.granted} games`, true);
    }
  }
  return runningWin;
}

// ---------------------------------------------------------------- Model B presentation
async function presentRoundB(round) {
  const spinEv = round.events.find((e) => e.kind === 'spin');
  const strips = stripsFor('B', false);
  const anticipate = computeAnticipation('B', strips, spinEv.stops);
  await animateTo('B', false, spinEv.stops, { anticipate });
  let runningWin = spinEv.line;
  if (spinEv.line > 0) { sound.lineWin(0); log(`Line win: <b>${fmt(spinEv.line)}</b>cr`); }
  await countUpWin(0, runningWin);

  const feat = round.events.find((e) => e.kind === 'feature');
  if (!feat) return runningWin;

  sound.featureTrigger();
  log(`${feat.triggerBulls} Money Bulls &rarr; <b>HOLD &amp; RESPIN</b>`, true);
  const ov = $('#featureOverlay');
  ov.classList.remove('hidden');
  const cellEls = [], extraEls = [];
  let extraCount = 0;
  const render = () => {
    ov.innerHTML = '';
    const head = document.createElement('div'); head.className = 'fhead'; head.id = 'fhead'; head.textContent = 'HOLD & RESPIN — 3 RESPINS';
    const sub = document.createElement('div'); sub.className = 'fsub'; sub.id = 'fsub'; sub.textContent = 'Any new prize resets respins to 3';
    const board = document.createElement('div'); board.className = 'fboard';
    for (let i = 0; i < 15; i++) {
      const row = Math.floor(i / 5), col = i % 5;
      const cell = document.createElement('div'); cell.className = 'fcell';
      board.appendChild(cell); cellEls[col * 3 + row] = cell;
    }
    const extraRow = document.createElement('div'); extraRow.className = 'fboard'; extraRow.id = 'fextra';
    ov.append(head, sub, board, extraRow);
  };
  render();
  const tick = state.turbo ? 50 : 340;
  for (const { cell, v } of feat.init) { cellEls[cell].classList.add('filled'); cellEls[cell].textContent = fmt(v); }
  await sleep(tick * 2);

  let phase = 1;
  for (const ev of feat.events) {
    if (ev.respin) {
      $('#fhead').textContent = (phase === 2 ? 'STAMPEDE PHASE — ' : 'HOLD & RESPIN — ') + ev.left + ' RESPIN' + (ev.left === 1 ? '' : 'S') + ' LEFT';
      sound.respinReset();
      await sleep(state.turbo ? 30 : 220);
      continue;
    }
    if (ev.phase === 2 && phase === 1) {
      phase = 2;
      $('#fhead').textContent = 'STAMPEDE PHASE';
      $('#fsub').textContent = 'Extra positions from Diamond Bulls are now live — cover every column for the Grand';
      sound.featureTrigger();
      await sleep(tick * 2);
    }
    let el;
    if (ev.isExtra) {
      el = extraEls[ev.cell];
      if (!el) { el = document.createElement('div'); el.className = 'fcell'; el.style.gridColumn = ev.col + 1; $('#fextra').appendChild(el); extraEls[ev.cell] = el; }
    } else el = cellEls[ev.cell];
    el.classList.add('filled', 'new');
    sound.coinCollect();
    if (ev.type === 'collector') { el.classList.add('collector'); el.textContent = fmt(ev.v); $('#fsub').textContent = `Collector Bull collects everything revealed: ${fmt(ev.v)} credits`; }
    else if (ev.type === 'diamond') {
      el.classList.add('diamond'); el.textContent = fmt(ev.v);
      if (extraCount < 12) { const slot = document.createElement('div'); slot.className = 'fcell'; slot.style.gridColumn = ev.col + 1; $('#fextra').appendChild(slot); extraEls[extraCount] = slot; extraCount++; }
    } else el.textContent = fmt(ev.v);
    await sleep(tick);
    el.classList.remove('new');
  }
  if (feat.grand) { sound.grand(); await flashMsg(`GRAND!<small>${fmt(feat.featureWin - (feat.init.reduce((s, i) => s + i.v, 0)))} bonus credits — ${feat.grandBy === 'fill' ? 'all 15 positions filled' : 'every column hit'}</small>`, 2200); }
  await flashMsg(`FEATURE PAYS<small><b>${fmt(feat.featureWin)}</b> credits</small>`, 1400);
  ov.classList.add('hidden');
  runningWin += feat.featureWin;
  await countUpWin(runningWin - feat.featureWin, runningWin);
  return runningWin;
}

// ---------------------------------------------------------------- spin flow
async function doSpin() {
  if (state.busy) return;
  state.busy = true;
  $('#spinBtn').disabled = true;
  $('#winCr').textContent = '0';
  cellBadges = {};
  sound.unlock();
  sound.click();
  sound.spinStart();
  try {
    const res = await fetch('/api/play/spin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: state.model, totalBet: state.totalBet }),
    });
    const data = await res.json();
    if (!res.ok) {
      sound.error();
      log(`<span style="color:var(--danger);">${data.error || 'Spin failed.'}</span>`);
      if (typeof data.balance === 'number') { state.balance = data.balance; $('#balanceCr').textContent = fmt(state.balance); }
      // 423 = a responsible-play limit kicked in (server/limits.js). Unlike a
      // plain failed spin, this stays locked until the player reloads — the
      // finally block below must not silently re-enable the button.
      if (res.status === 423) {
        state.blocked = true;
        $('#turboBtn').disabled = true;
        $('#autoBtn').disabled = true;
      }
      return { ok: false };
    }
    const win = state.model === 'A' ? await presentRoundA(data) : await presentRoundB(data);
    state.balance = data.balanceAfter;
    $('#balanceCr').textContent = fmt(state.balance);
    await celebrateWin(data.win, data.stake);
    return { ok: true, win: data.win, balance: state.balance };
  } catch (e) {
    sound.error();
    log(`<span style="color:var(--danger);">Connection error — spin not completed. Refresh to check your balance.</span>`);
    return { ok: false };
  } finally {
    state.busy = false;
    $('#spinBtn').disabled = !!state.blocked;
  }
}

// ---------------------------------------------------------------- controls
// A standard casino bet ladder, clipped to [minBet, maxBet] and always
// including both endpoints so the configured minimum/maximum are reachable
// even if they fall between rungs.
function betLadder(min, max) {
  const rungs = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 500, 750, 1000];
  const vals = new Set(rungs.filter((v) => v >= min && v <= max));
  vals.add(min); vals.add(max);
  return [...vals].sort((a, b) => a - b);
}
function populateBetSelect() {
  const sel = $('#betAmount');
  sel.innerHTML = '';
  betLadder(CFG.minBet, CFG.maxBet).forEach((v) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = `${v.toLocaleString()} cr`;
    sel.appendChild(o);
  });
  sel.value = state.totalBet;
  sel.addEventListener('change', () => { state.totalBet = Number(sel.value); });
}
populateBetSelect();

$('#spinBtn').addEventListener('click', () => doSpin());

$('#turboBtn').addEventListener('click', () => {
  state.turbo = !state.turbo;
  $('#turboBtn').classList.toggle('on', state.turbo);
  $('#turboState').textContent = state.turbo ? 'on' : 'off';
});

document.querySelectorAll('#modelTabs .tab').forEach((b) => b.addEventListener('click', () => {
  if (state.busy || b.disabled) return;
  document.querySelectorAll('#modelTabs .tab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.model = b.dataset.model;
  cellBadges = {};
  document.querySelector('.machine-wrap').classList.toggle('theme-b', state.model === 'B');
  drawWindow(state.model, stripsFor(state.model, false), [0, 12, 24, 36, 48]);
  log(`Switched to <b>${state.model === 'A' ? 'Golden Charge' : 'Thunder Herd'}</b>`);
}));

// ---------------------------------------------------------------- autoplay
const autoBtn = $('#autoBtn'), panel = $('#autoplayPanel');
autoBtn.addEventListener('click', () => panel.classList.toggle('hidden'));
$('#autoStart').addEventListener('click', async () => {
  if (state.autoplay.running) return;
  state.autoplay = { running: true, stop: false };
  $('#autoStart').disabled = true; $('#autoStop').disabled = false;
  $('#autoBtn').classList.add('on'); $('#autoState').textContent = 'on';
  const total = Number($('#autoCount').value);
  const winLimit = $('#autoWinLimit').value ? Number($('#autoWinLimit').value) : null;
  const lossFloor = $('#autoLossLimit').value ? Number($('#autoLossLimit').value) : null;
  let done = 0;
  const startBalance = state.balance;
  while (done < total && !state.autoplay.stop) {
    $('#autoStatus').textContent = `spin ${done + 1} of ${total}…`;
    const r = await doSpin();
    done++;
    if (!r.ok) break;
    if (winLimit !== null && r.win >= winLimit) { $('#autoStatus').textContent = `stopped: win of ${fmt(r.win)} reached your limit.`; break; }
    if (lossFloor !== null && r.balance <= lossFloor) { $('#autoStatus').textContent = `stopped: balance reached your floor.`; break; }
    if (state.balance < state.totalBet) { $('#autoStatus').textContent = `stopped: insufficient balance.`; break; }
  }
  if (!state.autoplay.stop && done >= total) $('#autoStatus').textContent = `done: ${done} spins, net ${state.balance - startBalance >= 0 ? '+' : ''}${fmt(state.balance - startBalance)}cr.`;
  state.autoplay.running = false;
  $('#autoStart').disabled = false; $('#autoStop').disabled = true;
  $('#autoBtn').classList.remove('on'); $('#autoState').textContent = 'off';
});
$('#autoStop').addEventListener('click', () => { state.autoplay.stop = true; $('#autoStatus').textContent = 'stopping…'; });

// ---------------------------------------------------------------- init
drawWindow(state.model, stripsFor(state.model, false), [0, 12, 24, 36, 48]);
log('Welcome to the floor. Every spin is resolved server-side — pick a game and spin.');
