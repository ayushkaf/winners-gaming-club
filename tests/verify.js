// tests/verify.js — deterministic verification of the feature math against the
// spec's worked examples. Run: node tests/verify.js
//
// Uses scripted RNG queues so every branch is forced, and identity checks over
// randomized spins so the invariants hold in general, not just on the script.

import { mulberry32 } from '../core/prng.js';
import { lineWin5 } from '../core/engine.js';
import { COIN_VALUES } from '../core/coins.js';
import {
  makeModelA, makeAccA, A, A_PAY, A_BEST, A_FREE_N,
} from '../models/modelA.js';
import {
  makeModelB, makeAccB, B_FEAT, B_GRAND,
} from '../models/modelB.js';
import { A_COIN_LOW, A_SILVER_LOW, B_COIN_LOW } from '../core/coins.js';

let passed = 0, failed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${info}`); }
}
function scriptedRng(queue) {
  let i = 0;
  const f = () => { if (i >= queue.length) throw new Error('rng queue exhausted'); return queue[i++]; };
  f.used = () => i;
  return f;
}

// ---------------------------------------------------------------- line rules
console.log('Line evaluator:');
const W = A.W;
check('5 leading wilds pay best 5oak', lineWin5(A_PAY, A_BEST, W, W, W, W, W, W) === A_BEST[5]);
check('W W W W 9 pays best 4oak (150), not 9 5oak (50)', lineWin5(A_PAY, A_BEST, W, W, W, W, W, A.NN) === 150);
check('H1 H1 W H1 H1 pays H1 5oak', lineWin5(A_PAY, A_BEST, W, A.H1, A.H1, W, A.H1, A.H1) === 750);
check('W H3 H1 H1 H1 pays nothing (run breaks)', lineWin5(A_PAY, A_BEST, W, W, A.H3, A.H1, A.H1, A.H1) === 0);
check('scatter never pays on lines', lineWin5(A_PAY, A_BEST, W, A.S, A.S, A.S, A.S, A.S) === 0);
check('coin never pays on lines', lineWin5(A_PAY, A_BEST, W, A.C, A.C, A.C, A.C, A.C) === 0);
check('A A A x x pays 15', lineWin5(A_PAY, A_BEST, W, A.AA, A.AA, A.AA, A.TT, A.NN) === 15);

// ------------------------------------------------- Model A: Charge Hit identity
// Worked example from the spec: 2 Bulls visible => EACH Bull collects the sum of
// ALL visible coin values (full sum paid twice), then each Bull reveals a
// silver prize. Verified as an identity over 200k random spins with detail
// capture: collect === bulls * sum(drawn coin values), silver draws === bulls.
console.log('Model A Charge Hit (double collect):');
{
  const model = makeModelA(A_COIN_LOW, A_SILVER_LOW);
  const rng = mulberry32(7);
  const acc = makeAccA();
  let events = 0, okCollect = true, okSilver = true, okGate = true, maxBulls = 0;
  for (let i = 0; i < 200000; i++) {
    const detail = { coinIdx: [], silverIdx: [] };
    const sp = model.spin(rng, i % 3 === 0, acc, detail); // mix base and free strips
    if (sp.bulls >= 2) {
      events++;
      maxBulls = Math.max(maxBulls, sp.bulls);
      const coinSum = detail.coinIdx.reduce((s, k) => s + COIN_VALUES[k], 0);
      const silverSum = detail.silverIdx.reduce((s, k) => s + COIN_VALUES[k], 0);
      if (sp.collect !== sp.bulls * coinSum) okCollect = false;
      if (detail.silverIdx.length !== sp.bulls || sp.silver !== silverSum) okSilver = false;
      if (detail.coinIdx.length !== sp.coins) okCollect = false;
    } else if (sp.collect !== 0 || sp.silver !== 0) okGate = false;
  }
  check(`collect == bulls x coinSum on all ${events} Charge Hits (max ${maxBulls} bulls)`, okCollect && events > 3000);
  check('exactly one silver reveal per bull, summed correctly', okSilver);
  check('no collect/silver below 2 bulls', okGate);
}

// ------------------------------------------------------- Model A: free games
console.log('Model A free games (3/4/5 => 15/20/25):');
{
  const model = makeModelA(A_COIN_LOW, A_SILVER_LOW);
  const rng = mulberry32(99);
  let checkedNoRetrig = 0, ok = true;
  for (let i = 0; i < 400000 && checkedNoRetrig < 50; i++) {
    const acc = makeAccA();
    const out = {};
    model.playRound(rng, out, acc);
    if (acc.freeTrig === 1 && acc.retrig === 0) {
      checkedNoRetrig++;
      // Without retriggers a session must run exactly its granted spins. The
      // grant is 15/20/25; we can't see the scatter count post-hoc, so assert
      // membership plus internal consistency.
      if (![15, 20, 25].includes(out.freeSpins)) ok = false;
    }
    if (acc.freeTrig === 0 && out.freeSpins !== 0) ok = false;
  }
  check(`free sessions without retrigger run exactly 15/20/25 spins (${checkedNoRetrig} sessions)`, ok && checkedNoRetrig === 50);
  check('grant table is 15/20/25', A_FREE_N[3] === 15 && A_FREE_N[4] === 20 && A_FREE_N[5] === 25);
}

// ---------------------------------------- Model B: scripted feature scenarios
console.log('Model B Hold & Respin (scripted):');
{
  const model = makeModelB(B_COIN_LOW);
  const NO = 0.99; // fails pLand
  const YES = 0.01; // passes pLand; also < pCollector when reused as type roll

  // Scenario 1 — collector collects ALL revealed prizes then sticks.
  // Init: 6 unit bulls (cells 0,1,2,3,4,5). Round 1: cell 6 lands (YES) and its
  // type roll is < pCollector => collector, value = current sum = 6.
  // Remaining 8 cells miss. Then three all-miss rounds end the feature.
  {
    const q = [];
    q.push(YES, 0.02); // cell 6: land, type=collector (0.02 < 0.06)
    for (let c = 7; c < 15; c++) q.push(NO); // rest of round 1
    for (let r = 0; r < 3; r++) for (let c = 6; c < 15; c++) if (c !== 6) q.push(NO); // 3 miss rounds (cell 6 now filled)
    const rng = scriptedRng(q);
    const acc = makeAccB();
    const f = model.playFeature(rng, [0, 1, 2, 3, 4, 5], model.unitDraw, acc, null);
    check('collector value = sum of all revealed (6) => total 12', f.win === 12 && !f.grand, `got ${f.win}`);
    check('collector counted once', acc.collectors === 1);
  }

  // Scenario 2 — Diamond Bull adds an extra position played in the Stampede
  // phase; reset-to-3 applies there; extra position counts toward its column.
  {
    const q = [];
    // Round 1: cell 6 lands, type roll 0.08 => not collector (>=0.06), diamond (<0.11)
    q.push(YES, 0.08);
    for (let c = 7; c < 15; c++) q.push(NO);
    // Main phase: three miss rounds over the 8 remaining empties
    for (let r = 0; r < 3; r++) for (let c = 7; c < 15; c++) q.push(NO);
    // Stampede phase round 1: 8 empty main cells miss, extra cell lands a credit
    for (let c = 7; c < 15; c++) q.push(NO);
    q.push(YES, 0.5); // extra: land, type=credit
    // Stampede: three miss rounds over 8 main empties (extra now filled)
    for (let r = 0; r < 3; r++) for (let c = 7; c < 15; c++) q.push(NO);
    const rng = scriptedRng(q);
    const acc = makeAccB();
    const f = model.playFeature(rng, [0, 1, 2, 3, 4, 5], model.unitDraw, acc, null);
    check('diamond => stampede phase ran, extra prize paid (6+1+1=8)', f.win === 8 && acc.phase2 === 1, `got ${f.win}`);
    check('diamond and extra position accounted', acc.diamonds === 1 && f.extraCount === 1);
    check('no grand from a single column hit', !f.grand);
  }

  // Scenario 3 — filling all 15 main positions pays the GRAND.
  {
    const q = [];
    for (let c = 6; c < 15; c++) q.push(YES, 0.5); // round 1: all 9 empties land credits
    const rng = scriptedRng(q);
    const acc = makeAccB();
    const f = model.playFeature(rng, [0, 1, 2, 3, 4, 5], model.unitDraw, acc, null);
    check('grid fill pays GRAND on top of prizes', f.win === 15 + B_GRAND && f.grand && f.grandBy === 'fill', `got ${f.win}`);
  }

  // Scenario 4 — reset-to-3: a landing on the third would-be-final round keeps
  // the feature alive.
  {
    const q = [];
    const empt = [6, 7, 8, 9, 10, 11, 12, 13, 14];
    for (let r = 0; r < 2; r++) for (const _ of empt) q.push(NO); // two miss rounds
    q.push(YES, 0.5); // round 3: first empty (cell 6) lands => reset to 3
    for (let i = 1; i < empt.length; i++) q.push(NO);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) q.push(NO); // then 3 misses over 8 empties
    const rng = scriptedRng(q);
    const acc = makeAccB();
    const f = model.playFeature(rng, [0, 1, 2, 3, 4, 5], model.unitDraw, acc, null);
    check('landing on last respin resets to 3 (win 7, no grand)', f.win === 7 && !f.grand, `got ${f.win}`);
  }
}

// ------------------------------------------- Model B: randomized invariants
console.log('Model B invariants (100k random features):');
{
  const model = makeModelB(B_COIN_LOW);
  const rng = mulberry32(1234);
  const acc = makeAccB();
  let ok = true, grands = 0, n = 0;
  for (let i = 0; i < 100000; i++) {
    const init = [0, 1, 2, 5, 8, 11]; // 6 bulls
    const f = model.playFeature(rng, init, model.unitDraw, acc, null);
    const base = f.win - (f.grand ? B_GRAND : 0);
    if (base < 6) ok = false; // can never pay less than the initial bulls
    if (f.grand) grands++;
    n++;
  }
  check(`coefficient sum >= initial bulls in all ${n} features`, ok);
  check(`grands occur but are rare (${grands})`, grands > 0 && grands / n < 0.05);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
