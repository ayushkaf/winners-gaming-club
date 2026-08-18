// server/engineBridge.js — server-authoritative round orchestration.
//
// This file does NOT modify core/ or models/. It imports their exported
// functions unchanged and replicates the exact control flow of
// modelA.playRound / modelB.playRound (same files, same trigger tables, same
// respin/retrigger rules) so that every credit paid out by this server is
// computed by the identical, already-validated engine code in reports/. The
// only reason this file exists rather than calling playRound() directly is
// that playRound() doesn't thread a `detail` object through for animation —
// so here we call the lower-level spin()/playFeature() primitives (which DO
// accept detail) in the same sequence playRound uses internally.
//
// Bet sizing: callers pass a `totalBet` in whole credits (any integer from
// the configured min up to the configured max — no fixed ladder). Internally
// mult = totalBet / BASE_BET rescales every credit figure the tuned 30-credit
// engine emits, which preserves RTP exactly for any bet size. Because bets
// below the 30-credit reference push some of the smallest pays (as low as 5cr
// at reference) under 1 credit, every individual figure is rounded to the
// nearest whole credit AT THE POINT IT'S EMITTED, and the round total is the
// SUM of those already-rounded figures — never a separate rounding of a
// float total. That guarantees what's displayed always adds up to exactly
// what's written to the ledger, at the cost of the tiniest reference-scale
// pays occasionally rounding down to 0 at very small bets (expected, and
// harmless for Demo Credits — the same thing happens on any real machine
// once you're below its minimum meaningful denomination).
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../../core/prng.js';
import { evalAllLines } from '../../core/engine.js';
import { COIN_VALUES, COIN_LABELS } from '../../core/coins.js';
import { makeModelA, makeAccA, A_TOTAL_BET, A_FREE_N, A_MAX_FREE_SPINS } from '../../models/modelA.js';
import { makeModelB, makeAccB, B, B_PAY, B_BEST, B_TRIGGER, B_GRAND } from '../../models/modelB.js';
import { log } from './db.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TUNED = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'tuned.json'), 'utf8'));

export const BASE_BET = A_TOTAL_BET; // === B_TOTAL_BET === 30, the tuned reference bet
export const DEFAULT_MIN_BET = 1;
export const DEFAULT_MAX_BET = 300;

// One continuous RNG stream for the server's lifetime, seeded from the OS CSPRNG
// at boot — mirrors a real cabinet's single free-running RNG rather than
// reseeding (and thus narrowing the effective entropy of) every spin.
//
// The seed is deliberately NOT logged and NOT returned by getModelSnapshot().
// mulberry32 is a fully deterministic 32-bit generator, so anyone holding this
// seed together with the engine source (core/prng.js, config/tuned.json,
// models/modelA.js, models/modelB.js) can replay the stream forward and know
// every future round's outcome before requesting it. The engine source is
// public, which makes the seed the only remaining secret in the outcome path —
// so it is treated like a key, not like telemetry. It never leaves this module.
const bootSeed = crypto.randomBytes(4).readUInt32LE(0);
const rng = mulberry32(bootSeed);
log('info', 'engine', 'RNG stream seeded at boot from OS CSPRNG');

const modelA = makeModelA(TUNED.A.coinWeights, TUNED.A.silverWeights);
const modelB = makeModelB(TUNED.B.coinWeights);
const accA = makeAccA();
const accB = makeAccB();

// A genuinely nonzero payout at the tuned 30-credit reference scale must
// never disappear to 0 credits just because a smaller bet scaled it below
// 0.5 — that was silently suppressing a big share of the model's real ~33%
// hit rate at low bets, making wins feel far rarer than the validated math
// actually produces. Floored at 1, never at 0 or negative (stakes aren't
// scaled through this helper).
const scale = (v, mult) => (v > 0 ? Math.max(1, Math.round(v * mult)) : 0);
function coinEvent(k, mult) {
  return { value: scale(COIN_VALUES[k], mult), label: COIN_LABELS[k] || null };
}

// Mirrors modelA.js `playRound` exactly, but threads a detail object through
// every spin() call and scales every credit figure by totalBet/BASE_BET.
export function playRoundA(totalBet) {
  const mult = totalBet / BASE_BET;
  const roundId = crypto.randomUUID();
  const events = [];
  let win = 0;

  const runSpin = (isFree) => {
    const detail = { coinIdx: [], silverIdx: [] };
    const sp = modelA.spin(rng, isFree, accA, detail);
    const ev = {
      kind: 'spin', isFree, stops: detail.stops,
      line: scale(sp.line, mult), scatters: sp.scatters, bulls: sp.bulls,
      scatterPay: scale(sp.scatterPay, mult),
      collect: scale(sp.collect, mult), silver: scale(sp.silver, mult),
      coins: detail.coinIdx.map((k) => coinEvent(k, mult)),
      silverReveals: detail.silverIdx.map((k) => coinEvent(k, mult)),
    };
    events.push(ev);
    win += ev.line + ev.scatterPay + ev.collect + ev.silver;
    return sp;
  };

  const b = runSpin(false);
  let freeSpins = 0;
  if (b.scatters >= 3) {
    let pending = A_FREE_N[Math.min(b.scatters, 5)];
    events.push({ kind: 'free_trigger', scatters: b.scatters, granted: pending });
    while (pending > 0 && freeSpins < A_MAX_FREE_SPINS) {
      pending--; freeSpins++;
      const f = runSpin(true);
      if (f.scatters >= 3) {
        const extra = A_FREE_N[Math.min(f.scatters, 5)];
        pending += extra;
        events.push({ kind: 'retrigger', scatters: f.scatters, granted: extra });
      }
    }
  }
  return { roundId, model: 'A', stake: totalBet, win, freeSpins, events };
}

// Mirrors modelB.js `playRound` exactly (bull-count trigger -> playFeature),
// with detail capture and the same bet scaling.
export function playRoundB(totalBet) {
  const mult = totalBet / BASE_BET;
  const roundId = crypto.randomUUID();
  const reels = modelB.reels, mcnt = modelB.mcnt;
  const stops = [];
  let m = 0;
  for (let r = 0; r < 5; r++) {
    const st = (rng() * reels[r].n) | 0;
    stops.push(st);
    m += mcnt[r][st];
  }
  const lineWinRaw = scale(evalLineB(reels, stops), mult);
  const events = [{ kind: 'spin', stops, line: lineWinRaw, bulls: m }];
  let win = lineWinRaw;
  let grand = false, grandBy = null;

  if (m >= B_TRIGGER) {
    const initCells = [];
    for (let r = 0; r < 5; r++) {
      const base = stops[r] * 3;
      for (let row = 0; row < 3; row++) if (reels[r].win[base + row] === B.M) initCells.push(r * 3 + row);
    }
    const det = { init: [], events: [] };
    const f = modelB.playFeature(rng, initCells, modelB.realDraw, accB, det);
    grand = f.grand; grandBy = f.grandBy;

    const initScaled = det.init.map((e) => ({ cell: e.cell, v: scale(e.v, mult) }));
    const eventsScaled = det.events.map((e) => e.respin
      ? { respin: true, phase: e.phase, left: e.left }
      : { phase: e.phase, cell: e.cell, isExtra: e.isExtra, col: e.col, type: e.type, v: scale(e.v, mult) });
    // featureWin is the sum of the already-rounded per-cell figures (plus the
    // rounded GRAND, if any) — not f.win*mult — so the feature breakdown the
    // client displays always adds up to exactly what's paid.
    let featureWin = initScaled.reduce((s, e) => s + e.v, 0) + eventsScaled.reduce((s, e) => s + (e.v || 0), 0);
    if (grand) featureWin += scale(B_GRAND, mult);
    win += featureWin;

    events.push({ kind: 'feature', triggerBulls: m, init: initScaled, events: eventsScaled, grand, grandBy, featureWin });
  }
  return { roundId, model: 'B', stake: totalBet, win, grand, grandBy, events };
}

function evalLineB(reels, stops) {
  return evalAllLines(reels, stops, B_PAY, B_BEST, B.W);
}

export function getModelSnapshot() {
  return {
    A: { name: 'Golden Charge', targetRTP: TUNED.A.target, exactRTP: TUNED.A.exactRTP, muCoin: TUNED.A.muCoin, muSilver: TUNED.A.muSilver },
    B: { name: 'Thunder Herd', targetRTP: TUNED.B.target, solvedRTP: TUNED.B.solvedRTP, muCoin: TUNED.B.muCoin },
    // bootSeed is intentionally absent — see the seeding comment above. This
    // object is serialised to any authenticated user by GET /api/play/state and
    // is passed into the public home template by routes/site.js, so nothing
    // secret may live here.
    baseBet: BASE_BET, defaultMinBet: DEFAULT_MIN_BET, defaultMaxBet: DEFAULT_MAX_BET,
  };
}
