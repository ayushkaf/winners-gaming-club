// core/engine.js — 5x3 weighted-strip reel engine + 30-line left-to-right evaluator.
//
// Strips are plain symbol arrays; weighting is by repetition, so every stop is
// equally likely and the strip layout (stacks, spacing) controls window joint
// distributions. Each reel precomputes the 3-symbol window for every stop so a
// spin is just 5 uniform stop draws + table lookups.

import { LINES_FLAT, N_LINES } from './lines.js';

export function buildStrip(len, placements, fillerCycle) {
  const s = new Array(len).fill(-1);
  for (const [sym, positions] of placements) {
    for (const p of positions) {
      if (p < 0 || p >= len) throw new Error(`position ${p} out of range`);
      if (s[p] !== -1) throw new Error(`strip collision at position ${p}`);
      s[p] = sym;
    }
  }
  let f = 0;
  for (let i = 0; i < len; i++) if (s[i] === -1) s[i] = fillerCycle[f++ % fillerCycle.length];
  return s;
}

export function makeReels(strips) {
  return strips.map((strip) => {
    const n = strip.length;
    const win = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      win[i * 3] = strip[i];
      win[i * 3 + 1] = strip[(i + 1) % n];
      win[i * 3 + 2] = strip[(i + 2) % n];
    }
    return { n, win, strip };
  });
}

// Per-stop count of `sym` in the 3-cell window — precomputed for hot loops.
export function stopCounts(reel, sym) {
  const a = new Uint8Array(reel.n);
  for (let i = 0; i < reel.n; i++) {
    let c = 0;
    for (let j = 0; j < 3; j++) if (reel.win[i * 3 + j] === sym) c++;
    a[i] = c;
  }
  return a;
}

// BEST[k] = best k-of-a-kind pay across all symbols; used when a leading wild
// run is worth more as its own best-symbol interpretation than the first
// non-wild symbol's run (e.g. W W W W 9 pays as 4-of-a-kind top symbol).
export function makeBest(PAY, nSym) {
  const best = new Int32Array(6);
  for (let k = 3; k <= 5; k++) {
    let b = 0;
    for (let s = 0; s < nSym; s++) if (PAY[s * 6 + k] > b) b = PAY[s * 6 + k];
    best[k] = b;
  }
  return best;
}

// Single-line evaluation, left to right, wilds substitute. Returns credits at
// 1 credit line bet. Pays start at 3-of-a-kind for every symbol, and the win is
// the best of (first-non-wild-symbol run) vs (pure leading-wild run as best symbol).
export function lineWin5(PAY, BEST, WILD, s0, s1, s2, s3, s4) {
  let k = 0; // leading wilds
  if (s0 === WILD) { k = 1; if (s1 === WILD) { k = 2; if (s2 === WILD) { k = 3; if (s3 === WILD) { k = 4; if (s4 === WILD) return BEST[5]; } } } }
  const t = k === 0 ? s0 : k === 1 ? s1 : k === 2 ? s2 : k === 3 ? s3 : s4;
  let run = k + 1; // run includes the first non-wild target symbol
  if (run === 1) { if (s1 === t || s1 === WILD) { run = 2; if (s2 === t || s2 === WILD) { run = 3; if (s3 === t || s3 === WILD) { run = 4; if (s4 === t || s4 === WILD) run = 5; } } } }
  else if (run === 2) { if (s2 === t || s2 === WILD) { run = 3; if (s3 === t || s3 === WILD) { run = 4; if (s4 === t || s4 === WILD) run = 5; } } }
  else if (run === 3) { if (s3 === t || s3 === WILD) { run = 4; if (s4 === t || s4 === WILD) run = 5; } }
  else if (run === 4) { if (s4 === t || s4 === WILD) run = 5; }
  const natural = PAY[t * 6 + run];
  const wildAlt = k >= 3 ? BEST[k] : 0;
  return natural > wildAlt ? natural : wildAlt;
}

// Evaluate all 30 lines for the current stops. Returns total line win in credits.
export function evalAllLines(reels, stops, PAY, BEST, WILD) {
  const w0 = reels[0].win, w1 = reels[1].win, w2 = reels[2].win, w3 = reels[3].win, w4 = reels[4].win;
  const b0 = stops[0] * 3, b1 = stops[1] * 3, b2 = stops[2] * 3, b3 = stops[3] * 3, b4 = stops[4] * 3;
  let total = 0;
  for (let l = 0, o = 0; l < N_LINES; l++, o += 5) {
    total += lineWin5(
      PAY, BEST, WILD,
      w0[b0 + LINES_FLAT[o]],
      w1[b1 + LINES_FLAT[o + 1]],
      w2[b2 + LINES_FLAT[o + 2]],
      w3[b3 + LINES_FLAT[o + 3]],
      w4[b4 + LINES_FLAT[o + 4]],
    );
  }
  return total;
}

// Multi-denomination support: bets and balances are in credits; the denom only
// scales credits to currency for display. RTP is denom-invariant by design.
export const DENOMS = [0.01, 0.02, 0.05, 0.1];
export function creditsToCurrency(credits, denom) {
  return credits * denom;
}
