// sim/exact.js — exact (combinatorial) return calculations.
//
// Because stops are uniform and reels independent, everything a base spin pays
// can be computed exactly:
//  - Line pays: the symbol a payline sees on reel r has the reel's symbol
//    frequency as its marginal (uniform stops), independent across reels =>
//    every line has identical EV; enumerate all nSym^5 symbol tuples through
//    the very same lineWin5() the simulator uses.
//  - Scatter / Bull / Coin window counts: enumerate the 60 stops per reel to
//    get each reel's joint (bull, coin, scatter) window-count distribution,
//    then convolve the 5 reels.
//  - Model A free games: same computations on the free strips; retriggers form
//    a branching process => expected total free spins per trigger =
//    n0 / (1 - m), with m = expected new spins added per free spin.
//
// Model A's total RTP is then a LINEAR function of the coin mean (muC) and the
// silver mean (muS) — solved in closed form by the tuner.

import { lineWin5 } from '../core/engine.js';

export function symbolFreqs(strips, nSym) {
  return strips.map((s) => {
    const f = new Float64Array(nSym);
    for (const sym of s) f[sym] += 1 / s.length;
    return f;
  });
}

// Exact EV (credits, 1-credit line bet) of ONE payline; multiply by 30 lines.
export function lineEVexact(freqs, PAY, BEST, WILD, nSym) {
  let ev = 0;
  const [f0, f1, f2, f3, f4] = freqs;
  for (let a = 0; a < nSym; a++) {
    const pa = f0[a]; if (pa === 0) continue;
    for (let b = 0; b < nSym; b++) {
      const pb = pa * f1[b]; if (pb === 0) continue;
      for (let c = 0; c < nSym; c++) {
        const pc = pb * f2[c]; if (pc === 0) continue;
        for (let d = 0; d < nSym; d++) {
          const pd = pc * f3[d]; if (pd === 0) continue;
          for (let e = 0; e < nSym; e++) {
            const pe = pd * f4[e]; if (pe === 0) continue;
            const w = lineWin5(PAY, BEST, WILD, a, b, c, d, e);
            if (w > 0) ev += pe * w;
          }
        }
      }
    }
  }
  return ev;
}

// Per-reel joint distribution of (countX, countY, countZ) in the 3-cell window,
// then 5-reel convolution. Counts are capped at 15 which is the true max.
export function windowTripleJoint(strips, symX, symY, symZ) {
  const DIM = 16;
  const perReel = strips.map((s) => {
    const n = s.length;
    const d = new Map();
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < 3; j++) {
        const sym = s[(i + j) % n];
        if (sym === symX) x++;
        else if (sym === symY) y++;
        else if (sym === symZ) z++;
      }
      const key = (x * 4 + y) * 4 + z;
      d.set(key, (d.get(key) || 0) + 1 / n);
    }
    return d;
  });
  // Convolve into a dense [X][Y][Z] cube.
  let J = new Float64Array(DIM * DIM * DIM);
  J[0] = 1;
  for (const d of perReel) {
    const nj = new Float64Array(DIM * DIM * DIM);
    for (let X = 0; X < DIM; X++) for (let Y = 0; Y < DIM; Y++) for (let Z = 0; Z < DIM; Z++) {
      const p = J[(X * DIM + Y) * DIM + Z];
      if (p === 0) continue;
      for (const [key, q] of d) {
        const x = (key >> 4) & 3, y = (key >> 2) & 3, z = key & 3;
        nj[((X + x) * DIM + Y + y) * DIM + Z + z] += p * q;
      }
    }
    J = nj;
  }
  return { J, DIM };
}

// Model A: derive from the (bull, coin, scatter) cube —
//  scatterDist[s], and the collect coefficients:
//    C = E[ B * N * 1{B>=2} ]   (multiplies muCoin)
//    S = E[ B * 1{B>=2} ]       (multiplies muSilver)
export function deriveA(cube) {
  const { J, DIM } = cube;
  const scatterDist = new Float64Array(16);
  let C = 0, S = 0, pXtra = 0;
  for (let Bc = 0; Bc < DIM; Bc++) for (let N = 0; N < DIM; N++) for (let Sc = 0; Sc < DIM; Sc++) {
    const p = J[(Bc * DIM + N) * DIM + Sc];
    if (p === 0) continue;
    scatterDist[Sc] += p;
    if (Bc >= 2) { C += p * Bc * N; S += p * Bc; pXtra += p; }
  }
  return { scatterDist, C, S, pXtra };
}

// Model A closed form. Returns coefficients so that
//   RTP_credits(muC, muS) = fixed + coefC * muC + coefS * muS
export function exactA(model) {
  const { A_BASE_STRIPS, A_FREE_STRIPS, A_PAY, A_BEST, A, A_NSYM, A_SC_PAY, A_FREE_N } = model;

  const lineB = 30 * lineEVexact(symbolFreqs(A_BASE_STRIPS, A_NSYM), A_PAY, A_BEST, A.W, A_NSYM);
  const lineF = 30 * lineEVexact(symbolFreqs(A_FREE_STRIPS, A_NSYM), A_PAY, A_BEST, A.W, A_NSYM);

  const dB = deriveA(windowTripleJoint(A_BASE_STRIPS, A.W, A.C, A.S));
  const dF = deriveA(windowTripleJoint(A_FREE_STRIPS, A.W, A.C, A.S));

  // Scatter pay + trigger probabilities (counts >5 impossible: 1 scatter max per reel).
  const spB = dB.scatterDist[3] * A_SC_PAY[3] + dB.scatterDist[4] * A_SC_PAY[4] + dB.scatterDist[5] * A_SC_PAY[5];
  const spF = dF.scatterDist[3] * A_SC_PAY[3] + dF.scatterDist[4] * A_SC_PAY[4] + dF.scatterDist[5] * A_SC_PAY[5];
  const pTrig = dB.scatterDist[3] + dB.scatterDist[4] + dB.scatterDist[5];

  // Branching factor: expected NEW free spins granted per free spin.
  const m = dF.scatterDist[3] * A_FREE_N[3] + dF.scatterDist[4] * A_FREE_N[4] + dF.scatterDist[5] * A_FREE_N[5];
  if (m >= 1) throw new Error('free-game branching factor >= 1 (infinite retriggers)');
  // Expected total free spins per base spin.
  const F = (dB.scatterDist[3] * A_FREE_N[3] + dB.scatterDist[4] * A_FREE_N[4] + dB.scatterDist[5] * A_FREE_N[5]) / (1 - m);

  const fixed = lineB + spB + F * (lineF + spF);
  const coefC = dB.C + F * dF.C;
  const coefS = dB.S + F * dF.S;

  return {
    lineB, lineF, spB, spF, pTrig, m, F, fixed, coefC, coefS,
    base: dB, free: dF,
    rtpCredits: (muC, muS) => fixed + coefC * muC + coefS * muS,
    decompose: (muC, muS) => ({
      line: lineB,
      scatterPay: spB,
      collect: dB.C * muC,
      silver: dB.S * muS,
      freeLine: F * lineF,
      freeScatterPay: F * spF,
      freeCollect: F * dF.C * muC,
      freeSilver: F * dF.S * muS,
    }),
  };
}

// Model B: exact line EV + exact Money-Bull count distribution (trigger prob).
export function exactB(model) {
  const { B_STRIPS, B_PAY, B_BEST, B, B_NSYM, B_TRIGGER } = model;
  const lineEV = 30 * lineEVexact(symbolFreqs(B_STRIPS, B_NSYM), B_PAY, B_BEST, B.W, B_NSYM);

  // Per-reel window M-count distribution -> 5-reel convolution.
  let dist = [1];
  for (const s of B_STRIPS) {
    const n = s.length;
    const d = new Float64Array(4);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let j = 0; j < 3; j++) if (s[(i + j) % n] === B.M) c++;
      d[c] += 1 / n;
    }
    const nd = new Array(dist.length + 3).fill(0);
    for (let a = 0; a < dist.length; a++) for (let b = 0; b < 4; b++) nd[a + b] += dist[a] * d[b];
    dist = nd;
  }
  let pTrig = 0, eInit = 0;
  for (let mCount = B_TRIGGER; mCount < dist.length; mCount++) { pTrig += dist[mCount]; eInit += dist[mCount] * mCount; }
  return { lineEV, mDist: dist, pTrig, eInitBulls: pTrig > 0 ? eInit / pTrig : 0 };
}
