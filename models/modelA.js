// models/modelA.js — Model A "Golden Charge" (classic collector).
//
// Mechanics:
//  - Bull = Wild on reels 2-4, substitutes for everything except the Gate
//    scatter and the Gold Coin.
//  - Charge Hit (double collect): whenever 2+ Bulls are visible anywhere in the
//    window, EACH Bull collects the sum of ALL visible Gold Coin values
//    (2 Bulls => the full coin sum is paid twice). After collecting, each Bull
//    transforms into a silver coin revealing its own credit prize or jackpot.
//  - Gate scatter: 3/4/5 anywhere => 15/20/25 free games on separate strips
//    with boosted Bull frequency. Retriggers allowed.
//
// Target: 96.09% RTP, high volatility. The coin/silver value distributions are
// the tuned parameters (see sim/tune.js); everything else is fixed design.

import { buildStrip, makeReels, stopCounts, makeBest, evalAllLines } from '../core/engine.js';
import { COIN_VALUES, COIN_LABELS, makeDrawer } from '../core/coins.js';

export const A = { W: 0, S: 1, C: 2, H1: 3, H2: 4, H3: 5, AA: 6, KK: 7, QQ: 8, JJ: 9, TT: 10, NN: 11 };
export const A_NSYM = 12;
export const A_NAMES = ['Bull (Wild)', 'Ranch Gate (Scatter)', 'Gold Coin', 'Golden Horseshoe', 'Cactus Bloom', 'Canyon Mesa', 'A', 'K', 'Q', 'J', '10', '9'];

export const A_TOTAL_BET = 30; // 30 lines x 1 credit
export const A_SC_PAY = [0, 0, 0, 60, 300, 3000]; // total-credit scatter pays for 3/4/5
export const A_FREE_N = [0, 0, 0, 15, 20, 25];
export const A_MAX_FREE_SPINS = 600; // safety cap, probability of reaching it is ~0

export const A_PAY = new Int32Array(A_NSYM * 6);
{
  const set = (sym, p3, p4, p5) => { A_PAY[sym * 6 + 3] = p3; A_PAY[sym * 6 + 4] = p4; A_PAY[sym * 6 + 5] = p5; };
  set(A.H1, 50, 150, 750);
  set(A.H2, 40, 100, 400);
  set(A.H3, 30, 80, 250);
  set(A.AA, 15, 40, 150);
  set(A.KK, 12, 35, 125);
  set(A.QQ, 10, 30, 100);
  set(A.JJ, 8, 25, 80);
  set(A.TT, 5, 20, 60);
  set(A.NN, 5, 15, 50);
  // W substitutes (no own line pay); S, C never pay on lines.
}
export const A_BEST = makeBest(A_PAY, A_NSYM);

const ROY = [A.AA, A.KK, A.QQ, A.JJ, A.TT, A.NN];

// Base strips (60 stops each). Wild only on reels 2-4, isolated. Scatters
// isolated (max one per reel window).
export const A_BASE_STRIPS = [
  buildStrip(60, [[A.S, [14, 44]], [A.C, [4, 24, 50]], [A.H1, [0, 20, 40]], [A.H2, [7, 17, 31, 53]], [A.H3, [10, 27, 37, 57]]], ROY),
  buildStrip(60, [[A.W, [8, 38]], [A.S, [16, 46]], [A.C, [5, 25, 52]], [A.H1, [1, 21, 41]], [A.H2, [11, 28, 43, 58]], [A.H3, [3, 19, 34, 55]]], ROY),
  buildStrip(60, [[A.W, [9, 39]], [A.S, [17, 47]], [A.C, [6, 26, 36, 53]], [A.H1, [2, 22, 42]], [A.H2, [12, 29, 50, 59]], [A.H3, [4, 20, 33, 56]]], ROY),
  buildStrip(60, [[A.W, [10, 40]], [A.S, [18, 48]], [A.C, [7, 27, 37, 54]], [A.H1, [3, 23, 43]], [A.H2, [13, 30, 51]], [A.H3, [5, 21, 34, 57]]], ROY),
  buildStrip(60, [[A.S, [15, 45]], [A.C, [2, 22, 32, 42, 52]], [A.H1, [6, 26, 46, 56]], [A.H2, [9, 29, 49]], [A.H3, [12, 36, 58]]], ROY),
];

// Free-game strips: boosted Bulls on reels 2-4 (including one 2-stack each) and
// one extra coin per reel. Scatter density unchanged (retriggers).
export const A_FREE_STRIPS = [
  buildStrip(60, [[A.S, [14, 44]], [A.C, [4, 24, 34, 50]], [A.H1, [0, 20, 40]], [A.H2, [7, 17, 31, 53]], [A.H3, [10, 27, 37, 57]]], ROY),
  buildStrip(60, [[A.W, [8, 9, 24, 38, 54]], [A.S, [16, 46]], [A.C, [5, 25, 33, 52]], [A.H1, [1, 21, 41]], [A.H2, [11, 28, 43, 58]], [A.H3, [3, 19, 35, 55]]], ROY),
  buildStrip(60, [[A.W, [9, 10, 26, 39, 55]], [A.S, [17, 47]], [A.C, [6, 27, 36, 53]], [A.H1, [2, 22, 42]], [A.H2, [12, 29, 50, 59]], [A.H3, [4, 20, 33, 56]]], ROY),
  buildStrip(60, [[A.W, [10, 11, 27, 40, 56]], [A.S, [18, 48]], [A.C, [7, 28, 37, 54]], [A.H1, [3, 23, 43]], [A.H2, [13, 30, 51]], [A.H3, [5, 21, 34, 57]]], ROY),
  buildStrip(60, [[A.S, [15, 45]], [A.C, [2, 12, 22, 32, 42, 52]], [A.H1, [6, 26, 46, 56]], [A.H2, [9, 29, 49]], [A.H3, [19, 36, 58]]], ROY),
];

export function makeModelA(coinWeights, silverWeights) {
  const base = makeReels(A_BASE_STRIPS);
  const free = makeReels(A_FREE_STRIPS);
  const counts = (reels) => ({
    s: reels.map((r) => stopCounts(r, A.S)),
    w: reels.map((r) => stopCounts(r, A.W)),
    c: reels.map((r) => stopCounts(r, A.C)),
  });
  const bc = counts(base);
  const fc = counts(free);
  const coin = makeDrawer(coinWeights);
  const silver = makeDrawer(silverWeights);
  const stops = new Int32Array(5);

  // Reused per-spin scratch; playRound copies what it keeps.
  const sp = { line: 0, scatters: 0, bulls: 0, coins: 0, collect: 0, silver: 0, scatterPay: 0 };

  // One spin on the given strip set. `detail`, when provided, records stops and
  // value-draw indices for the demo UI without changing the RNG stream.
  function spin(rng, isFree, acc, detail) {
    const reels = isFree ? free : base;
    const cc = isFree ? fc : bc;
    let sc = 0, bulls = 0, coins = 0;
    for (let r = 0; r < 5; r++) {
      const st = (rng() * reels[r].n) | 0;
      stops[r] = st;
      sc += cc.s[r][st];
      bulls += cc.w[r][st];
      coins += cc.c[r][st];
    }
    sp.line = evalAllLines(reels, stops, A_PAY, A_BEST, A.W);
    sp.scatters = sc;
    sp.bulls = bulls;
    sp.coins = coins;
    sp.scatterPay = sc >= 3 ? A_SC_PAY[sc > 5 ? 5 : sc] : 0;
    sp.collect = 0;
    sp.silver = 0;
    if (bulls >= 2) {
      // Charge Hit: each bull collects the full visible coin sum...
      let sum = 0;
      for (let i = 0; i < coins; i++) {
        const k = coin.draw(rng);
        sum += COIN_VALUES[k];
        if (COIN_LABELS[k]) acc.jp[COIN_LABELS[k]] += bulls; // each bull pays this label's value
        if (detail) detail.coinIdx.push(k);
      }
      sp.collect = bulls * sum;
      // ...then transforms into a silver coin with its own prize.
      let sv = 0;
      for (let i = 0; i < bulls; i++) {
        const k = silver.draw(rng);
        sv += COIN_VALUES[k];
        if (COIN_LABELS[k]) acc.jp[COIN_LABELS[k]] += 1;
        if (detail) detail.silverIdx.push(k);
      }
      sp.silver = sv;
      if (isFree) acc.xtraFree++; else acc.xtraBase++;
    }
    if (detail) { detail.stops = Array.from(stops); detail.isFree = isFree; }
    return sp;
  }

  // A full round = one paid base spin + all free games it triggers (retriggers
  // included). `out` is the caller-owned result object, `acc` the counters sink.
  function playRound(rng, out, acc) {
    const b = spin(rng, false, acc, null);
    out.line = b.line;
    out.scatterPay = b.scatterPay;
    out.collect = b.collect;
    out.silver = b.silver;
    out.fLine = 0; out.fScatterPay = 0; out.fCollect = 0; out.fSilver = 0;
    out.freeSpins = 0;
    if (b.scatters >= 3) {
      acc.freeTrig++;
      let pending = A_FREE_N[b.scatters > 5 ? 5 : b.scatters];
      while (pending > 0 && out.freeSpins < A_MAX_FREE_SPINS) {
        pending--;
        out.freeSpins++;
        const f = spin(rng, true, acc, null);
        out.fLine += f.line;
        out.fScatterPay += f.scatterPay;
        out.fCollect += f.collect;
        out.fSilver += f.silver;
        if (f.scatters >= 3) { pending += A_FREE_N[f.scatters > 5 ? 5 : f.scatters]; acc.retrig++; }
      }
      acc.freeSpins += out.freeSpins;
    }
    out.win = out.line + out.scatterPay + out.collect + out.silver +
      out.fLine + out.fScatterPay + out.fCollect + out.fSilver;
    return out;
  }

  return { base, free, coin, silver, spin, playRound, stops };
}

export function makeAccA() {
  return { xtraBase: 0, xtraFree: 0, freeTrig: 0, retrig: 0, freeSpins: 0, jp: { MINI: 0, MINOR: 0, MEGA: 0, GRAND: 0 } };
}
