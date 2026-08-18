// sim/tune.js — auto-tuner. Solves the coin-value distribution so that the TRUE
// model RTP equals the target, then writes config/tuned.json.
//
//   node sim/tune.js A
//   node sim/tune.js B [nFeatures]
//
// Model A: fully closed-form. RTP(muC, muS) is linear (see sim/exact.js);
// with the design ratio muS = 0.5 * muC there is exactly one solution, and the
// weight vectors are then solved to that mean by bisection => the true RTP
// matches target to double precision.
//
// Model B: line EV and trigger probability are exact; the feature's expected
// payout is  E[coeffSum] * muC + P(grand) * GRAND  where coeffSum is a pure
// STRUCTURE quantity (independent of drawn values — a collector's value is the
// sum of already-revealed values, so the final payout is a random linear
// combination of iid draws whose coefficient structure does not depend on the
// values themselves). We estimate E[coeffSum] and P(grand) with a large
// feature-only Monte Carlo (unit-value drawer), then solve muC in closed form.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../core/prng.js';
import {
  A_COIN_LOW, A_COIN_HIGH, A_SILVER_LOW, A_SILVER_HIGH, B_COIN_LOW, B_COIN_HIGH,
  solveWeightsForMean, distMean,
} from '../core/coins.js';
import * as MA from '../models/modelA.js';
import * as MB from '../models/modelB.js';
import { makeModelB, makeAccB, B_TRIGGER, B_TOTAL_BET, B_GRAND } from '../models/modelB.js';
import { exactA, exactB } from './exact.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = path.join(ROOT, 'config', 'tuned.json');

const TARGET = { A: 0.9609, B: 0.961 };
const SILVER_RATIO = 0.5; // design choice: muSilver = 0.5 * muCoin

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

function tuneA() {
  const ex = exactA(MA);
  const targetCredits = TARGET.A * MA.A_TOTAL_BET;
  const denom = ex.coefC + SILVER_RATIO * ex.coefS;
  const muC = (targetCredits - ex.fixed) / denom;
  const muS = SILVER_RATIO * muC;
  console.log('--- Model A exact solve ---');
  console.log(`line(base)=${ex.lineB.toFixed(4)}cr  line(free spin)=${ex.lineF.toFixed(4)}cr`);
  console.log(`scatterPay(base)=${ex.spB.toFixed(4)}  P(free trigger)=${ex.pTrig.toExponential(4)} (1 in ${(1 / ex.pTrig).toFixed(1)})`);
  console.log(`free branching m=${ex.m.toFixed(4)}  E[free spins per base spin]=${ex.F.toFixed(5)}`);
  console.log(`P(ChargeHit base)=${ex.base.pXtra.toExponential(4)} (1 in ${(1 / ex.base.pXtra).toFixed(1)})  P(ChargeHit free)=${ex.free.pXtra.toFixed(4)}`);
  console.log(`fixed=${ex.fixed.toFixed(4)}cr  coefC=${ex.coefC.toFixed(6)}  coefS=${ex.coefS.toFixed(6)}`);
  console.log(`solved muCoin=${muC.toFixed(4)}cr  muSilver=${muS.toFixed(4)}cr`);
  console.log(`profile ranges: coin [${distMean(A_COIN_LOW).toFixed(1)}, ${distMean(A_COIN_HIGH).toFixed(1)}]  silver [${distMean(A_SILVER_LOW).toFixed(1)}, ${distMean(A_SILVER_HIGH).toFixed(1)}]`);

  const coinWeights = solveWeightsForMean(A_COIN_LOW, A_COIN_HIGH, muC);
  const silverWeights = solveWeightsForMean(A_SILVER_LOW, A_SILVER_HIGH, muS);
  const rtp = ex.rtpCredits(distMean(coinWeights), distMean(silverWeights)) / MA.A_TOTAL_BET;
  const d = ex.decompose(muC, muS);
  console.log('decomposition (credits/spin of 30):');
  for (const [k, v] of Object.entries(d)) console.log(`  ${k.padEnd(15)} ${v.toFixed(4)}  (${(100 * v / MA.A_TOTAL_BET).toFixed(3)}% of bet)`);
  console.log(`exact RTP with solved weights = ${(100 * rtp).toFixed(6)}%  (target ${(100 * TARGET.A).toFixed(2)}%)`);

  const cfg = loadConfig();
  cfg.A = {
    target: TARGET.A,
    exactRTP: rtp,
    muCoin: muC,
    muSilver: muS,
    coinWeights,
    silverWeights,
    decomposition: d,
    pFreeTrigger: ex.pTrig,
    pChargeHitBase: ex.base.pXtra,
    expectedFreeSpinsPerTrigger: ex.F / ex.pTrig,
    tunedAt: new Date().toISOString(),
  };
  saveConfig(cfg);
  console.log(`written ${CONFIG}`);
}

function tuneB(nFeatures) {
  const ex = exactB(MB);
  console.log('--- Model B exact base ---');
  console.log(`line EV=${ex.lineEV.toFixed(4)}cr  P(trigger)=${ex.pTrig.toExponential(4)} (1 in ${(1 / ex.pTrig).toFixed(1)})  E[init bulls|trig]=${ex.eInitBulls.toFixed(3)}`);

  // Feature-structure Monte Carlo with the unit drawer. Cheap trigger hunting:
  // only bull counts are computed until a trigger occurs.
  const model = makeModelB(B_COIN_LOW); // weights irrelevant in unit mode
  const rng = mulberry32(20260808);
  const acc = makeAccB();
  const reels = model.reels, mcnt = model.mcnt;
  const initCells = [];
  let feats = 0, sumS = 0, sumS2 = 0, grands = 0, spins = 0;
  const t0 = Date.now();
  while (feats < nFeatures) {
    spins++;
    let m = 0;
    const s0 = (rng() * 60) | 0, s1 = (rng() * 60) | 0, s2 = (rng() * 60) | 0, s3 = (rng() * 60) | 0, s4 = (rng() * 60) | 0;
    m = mcnt[0][s0] + mcnt[1][s1] + mcnt[2][s2] + mcnt[3][s3] + mcnt[4][s4];
    if (m < B_TRIGGER) continue;
    initCells.length = 0;
    const stops = [s0, s1, s2, s3, s4];
    for (let r = 0; r < 5; r++) {
      const b = stops[r] * 3;
      for (let row = 0; row < 3; row++) if (reels[r].win[b + row] === MB.B.M) initCells.push(r * 3 + row);
    }
    const f = model.playFeature(rng, initCells, model.unitDraw, acc, null);
    const coeff = f.win - (f.grand ? B_GRAND : 0); // unit mode: win == coeffSum (+GRAND flag)
    sumS += coeff; sumS2 += coeff * coeff;
    if (f.grand) grands++;
    feats++;
  }
  const S = sumS / feats;
  const sdS = Math.sqrt(sumS2 / feats - S * S);
  const seS = sdS / Math.sqrt(feats);
  const G = grands / feats;
  const seG = Math.sqrt(G * (1 - G) / feats);
  const secs = (Date.now() - t0) / 1000;
  console.log(`hunted ${feats.toLocaleString()} features in ${spins.toLocaleString()} spins (${secs.toFixed(1)}s)`);
  console.log(`observed trigger rate 1 in ${(spins / feats).toFixed(1)} (exact: 1 in ${(1 / ex.pTrig).toFixed(1)})`);
  console.log(`E[coeffSum]=${S.toFixed(4)} +- ${seS.toFixed(4)} (sd ${sdS.toFixed(2)})`);
  console.log(`P(grand|feature)=${G.toExponential(4)} +- ${seG.toExponential(2)}  (fill: ${acc.grandFill}, columns: ${acc.grandCols})`);
  console.log(`avg landings/feature=${(acc.landings / feats).toFixed(3)}  collectors/feature=${(acc.collectors / feats).toFixed(4)}  diamonds/feature=${(acc.diamonds / feats).toFixed(4)}  P(phase2)=${(acc.phase2 / feats).toFixed(4)}`);

  const targetCredits = TARGET.B * B_TOTAL_BET;
  const muC = (targetCredits - ex.lineEV - ex.pTrig * G * B_GRAND) / (ex.pTrig * S);
  console.log(`solved muCoin=${muC.toFixed(4)}cr  (profile range [${distMean(B_COIN_LOW).toFixed(1)}, ${distMean(B_COIN_HIGH).toFixed(1)}])`);
  const coinWeights = solveWeightsForMean(B_COIN_LOW, B_COIN_HIGH, muC);

  const featEV = S * muC + G * B_GRAND;
  const rtp = (ex.lineEV + ex.pTrig * featEV) / B_TOTAL_BET;
  // Uncertainty on true RTP from the structure estimates:
  const seRTP = ex.pTrig * Math.sqrt((seS * muC) ** 2 + (seG * B_GRAND) ** 2) / B_TOTAL_BET;
  console.log(`E[feature payout]=${featEV.toFixed(2)}cr (${(featEV / B_TOTAL_BET).toFixed(2)}x bet)`);
  console.log(`solved RTP = ${(100 * rtp).toFixed(4)}% +- ${(100 * 1.96 * seRTP).toFixed(4)}% (95% CI on true RTP)`);

  const cfg = loadConfig();
  cfg.B = {
    target: TARGET.B,
    solvedRTP: rtp,
    rtpCI95HalfWidth: 1.96 * seRTP,
    muCoin: muC,
    coinWeights,
    lineEV: ex.lineEV,
    pTrigger: ex.pTrig,
    eInitBulls: ex.eInitBulls,
    structure: {
      nFeatures: feats,
      coeffSumMean: S, coeffSumSD: sdS, coeffSumSE: seS,
      pGrand: G, pGrandSE: seG,
      grandFillShare: acc.grandFill / Math.max(grands, 1),
      landingsPerFeature: acc.landings / feats,
      collectorsPerFeature: acc.collectors / feats,
      diamondsPerFeature: acc.diamonds / feats,
      pPhase2: acc.phase2 / feats,
      featureEV: featEV,
    },
    tunedAt: new Date().toISOString(),
  };
  saveConfig(cfg);
  console.log(`written ${CONFIG}`);
}

const which = (process.argv[2] || 'A').toUpperCase();
if (which === 'A') tuneA();
else if (which === 'B') tuneB(Number(process.argv[3]) || 6_000_000);
else { console.error('usage: node sim/tune.js A|B [nFeatures]'); process.exit(1); }
