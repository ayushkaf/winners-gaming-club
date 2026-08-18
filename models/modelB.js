// models/modelB.js — Model B "Thunder Herd" (hold & respin).
//
// Mechanics:
//  - Money Bull symbol lands on all reels (with 3-high stacks) carrying a
//    credit value or a MINI/MINOR/MEGA label.
//  - 6+ Money Bulls visible => Hold & Respin: the triggering bulls stick, the
//    grid switches to 15 independent positions, respins start at 3. Every
//    respin, each empty position independently lands a prize with probability
//    pLand. Any new prize resets respins to 3.
//  - Collector Bull (small share of feature landings): its value is the sum of
//    ALL currently revealed prizes; it then sticks like any other prize.
//  - Diamond Bull (small share of landings): a normal credit prize that also
//    adds one extra grid position, played in a second "Stampede phase" after
//    the main feature ends. Reset-to-3 applies there too. In the Stampede
//    phase, remaining empty main positions AND the extra positions are live.
//  - GRAND (30,000cr = 1000x bet): fill all 15 main positions (either phase),
//    OR land at least one prize in every column during the Stampede phase.
//    (Extra positions count toward the column of the Diamond Bull that
//    created them.)
//  - W is a plain line wild on reels 2-4 (no collect behaviour in this model).
//
// Target: 96.10% RTP, very high volatility. Tuned parameter: the money-bull
// value distribution (mean solved in closed form from measured feature
// structure — see sim/tune.js).

import { buildStrip, makeReels, stopCounts, makeBest, evalAllLines } from '../core/engine.js';
import { COIN_VALUES, COIN_LABELS, makeDrawer } from '../core/coins.js';

export const B = { W: 0, M: 1, H1: 2, H2: 3, H3: 4, AA: 5, KK: 6, QQ: 7, JJ: 8, TT: 9, NN: 10 };
export const B_NSYM = 11;
export const B_NAMES = ['Wild', 'Money Bull', 'Golden Horseshoe', 'Cactus Bloom', 'Canyon Mesa', 'A', 'K', 'Q', 'J', '10', '9'];

export const B_TOTAL_BET = 30;
export const B_TRIGGER = 6;
export const B_RESPINS = 3;
export const B_GRAND = 30000; // 1000x total bet
export const B_FEAT = {
  pLand: 0.06,      // per empty position, per respin
  pCollector: 0.06, // share of landings that are Collector Bulls
  pDiamond: 0.05,   // share of landings that are Diamond Bulls
  maxExtra: 12,     // safety cap on Stampede-phase extra positions
  maxRounds: 500,   // safety cap on respin rounds per phase
};

export const B_PAY = new Int32Array(B_NSYM * 6);
{
  const set = (sym, p3, p4, p5) => { B_PAY[sym * 6 + 3] = p3; B_PAY[sym * 6 + 4] = p4; B_PAY[sym * 6 + 5] = p5; };
  set(B.H1, 50, 150, 750);
  set(B.H2, 40, 100, 400);
  set(B.H3, 30, 80, 250);
  set(B.AA, 15, 40, 150);
  set(B.KK, 12, 35, 125);
  set(B.QQ, 10, 30, 100);
  set(B.JJ, 8, 25, 80);
  set(B.TT, 5, 20, 60);
  set(B.NN, 5, 15, 50);
  // W substitutes; M (Money Bull) never pays on lines.
}
export const B_BEST = makeBest(B_PAY, B_NSYM);

const ROY = [B.AA, B.KK, B.QQ, B.JJ, B.TT, B.NN];

// 60-stop strips; every reel carries one 3-stack of Money Bulls + two singles.
export const B_STRIPS = [
  buildStrip(60, [[B.M, [10, 11, 12, 30, 50]], [B.H1, [0, 20, 40]], [B.H2, [5, 17, 35, 55]], [B.H3, [3, 25, 45, 58]]], ROY),
  buildStrip(60, [[B.W, [8, 38]], [B.M, [14, 15, 16, 34, 54]], [B.H1, [1, 21, 41]], [B.H2, [6, 28, 48]], [B.H3, [4, 24, 44, 59]]], ROY),
  buildStrip(60, [[B.W, [9, 39]], [B.M, [18, 19, 20, 36, 56]], [B.H1, [2, 22, 42]], [B.H2, [7, 29, 49]], [B.H3, [5, 25, 45, 59]]], ROY),
  buildStrip(60, [[B.W, [10, 40]], [B.M, [22, 23, 24, 4, 44]], [B.H1, [0, 30, 50]], [B.H2, [7, 17, 37]], [B.H3, [13, 33, 53, 57]]], ROY),
  buildStrip(60, [[B.M, [26, 27, 28, 6, 46]], [B.H1, [2, 22, 42, 52]], [B.H2, [9, 19, 39]], [B.H3, [13, 33, 49]]], ROY),
];

export function makeModelB(coinWeights) {
  const reels = makeReels(B_STRIPS);
  const mcnt = reels.map((r) => stopCounts(r, B.M));
  const coin = makeDrawer(coinWeights);
  const stops = new Int32Array(5);

  // Feature scratch (reused across calls).
  const vals = new Float64Array(15);
  const extraCol = new Int8Array(B_FEAT.maxExtra);
  const extraVal = new Float64Array(B_FEAT.maxExtra);
  const colHit = new Uint8Array(5);

  // drawValue: () => credits. Real mode draws from the coin distribution;
  // structure/hunt mode passes a unit drawer (always 1) so the accumulated
  // "win" is exactly the value-coefficient sum — used by the tuner.
  // det (optional): {init:[{cell,v}], events:[...]} for the demo UI.
  function playFeature(rng, initCells, drawValue, acc, det) {
    vals.fill(0);
    colHit.fill(0);
    let filled = 0, curSum = 0, extraCount = 0, extraFilled = 0;
    for (const cell of initCells) {
      const v = drawValue(rng);
      vals[cell] = v; curSum += v; filled++;
      if (det) det.init.push({ cell, v });
    }

    const land = (isPhase2, cell, isExtra, srcCol) => {
      const u = rng();
      let v, type;
      if (u < B_FEAT.pCollector && curSum > 0) {
        v = curSum; type = 'collector'; acc.collectors++;
      } else {
        v = drawValue(rng); type = 'credit';
        if (u < B_FEAT.pCollector + B_FEAT.pDiamond) {
          type = 'diamond'; acc.diamonds++;
          if (extraCount < B_FEAT.maxExtra) { extraCol[extraCount] = srcCol; extraVal[extraCount] = -1; extraCount++; }
        }
      }
      if (isExtra) { extraVal[cell] = v; extraFilled++; }
      else { vals[cell] = v; filled++; }
      curSum += v;
      acc.landings++;
      if (isPhase2) colHit[srcCol] = 1;
      if (det) det.events.push({ phase: isPhase2 ? 2 : 1, cell, isExtra, col: srcCol, type, v });
      return type;
    };

    // ---- Main phase: 15 positions, respins start at 3, any landing resets.
    let respins = B_RESPINS, rounds = 0;
    while (respins > 0 && filled < 15 && rounds < B_FEAT.maxRounds) {
      rounds++;
      let landed = false;
      for (let cell = 0; cell < 15; cell++) {
        if (vals[cell] === 0 && rng() < B_FEAT.pLand) {
          land(false, cell, false, (cell / 3) | 0);
          landed = true;
        }
      }
      respins = landed ? B_RESPINS : respins - 1;
      if (det) det.events.push({ phase: 1, respin: true, left: respins });
    }
    let grand = filled === 15;
    let grandBy = grand ? 'fill' : null;

    // ---- Stampede phase: only if Diamond Bulls added extra positions.
    if (extraCount > 0) {
      acc.phase2++;
      respins = B_RESPINS; rounds = 0;
      while (respins > 0 && (filled < 15 || extraFilled < extraCount) && rounds < B_FEAT.maxRounds) {
        rounds++;
        let landed = false;
        for (let cell = 0; cell < 15; cell++) {
          if (vals[cell] === 0 && rng() < B_FEAT.pLand) {
            land(true, cell, false, (cell / 3) | 0);
            landed = true;
          }
        }
        for (let e = 0; e < extraCount; e++) {
          if (extraVal[e] < 0 && rng() < B_FEAT.pLand) {
            land(true, e, true, extraCol[e]);
            landed = true;
          }
        }
        respins = landed ? B_RESPINS : respins - 1;
        if (det) det.events.push({ phase: 2, respin: true, left: respins });
      }
      if (filled === 15 && !grand) { grand = true; grandBy = 'fill'; }
      if (colHit[0] && colHit[1] && colHit[2] && colHit[3] && colHit[4]) {
        if (!grand) grandBy = 'columns';
        grand = true;
      }
    }

    if (grand) { acc.grands++; if (grandBy === 'fill') acc.grandFill++; else acc.grandCols++; }
    return { win: curSum + (grand ? B_GRAND : 0), grand, grandBy, extraCount };
  }

  // Real-money value drawer (tracks jackpot-label hits through acc via closure
  // set per playRound call).
  let jpAcc = null;
  const realDraw = (rng) => {
    const k = coin.draw(rng);
    if (COIN_LABELS[k] && jpAcc) jpAcc.jp[COIN_LABELS[k]]++;
    return COIN_VALUES[k];
  };
  const unitDraw = () => 1;

  const initCells = [];
  function playRound(rng, out, acc) {
    let m = 0;
    for (let r = 0; r < 5; r++) {
      const st = (rng() * reels[r].n) | 0;
      stops[r] = st;
      m += mcnt[r][st];
    }
    out.line = evalAllLines(reels, stops, B_PAY, B_BEST, B.W);
    out.feature = 0;
    out.grand = false;
    out.bulls = m;
    if (m >= B_TRIGGER) {
      acc.trig++;
      initCells.length = 0;
      for (let r = 0; r < 5; r++) {
        const b = stops[r] * 3;
        for (let row = 0; row < 3; row++) if (reels[r].win[b + row] === B.M) initCells.push(r * 3 + row);
      }
      jpAcc = acc;
      const f = playFeature(rng, initCells, realDraw, acc, null);
      jpAcc = null;
      out.feature = f.win;
      out.grand = f.grand;
    }
    out.win = out.line + out.feature;
    return out;
  }

  return { reels, mcnt, coin, playRound, playFeature, unitDraw, realDraw, stops };
}

export function makeAccB() {
  return { trig: 0, landings: 0, collectors: 0, diamonds: 0, phase2: 0, grands: 0, grandFill: 0, grandCols: 0, jp: { MINI: 0, MINOR: 0, MEGA: 0, GRAND: 0 } };
}
