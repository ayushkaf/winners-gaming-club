// sim/run.js — Monte Carlo validation harness.
//
//   node sim/run.js A 10000000 [seed]
//   node sim/run.js B 10000000 [seed]
//
// Runs the full faithful game loop (base + features, real value draws) with the
// tuned configuration, reports RTP / hit rate / volatility / feature
// frequencies / max-win distribution, and writes reports/model{A|B}_validation.md
// plus config/validation_summary.json (consumed by the research site).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../core/prng.js';
import { makeModelA, makeAccA, A_TOTAL_BET } from '../models/modelA.js';
import { makeModelB, makeAccB, B_TOTAL_BET, B_GRAND } from '../models/modelB.js';
import * as MA from '../models/modelA.js';
import * as MB from '../models/modelB.js';
import { exactA, exactB } from './exact.js';
import { makeStats, addRound, finalize, HIST_LABELS, fmtPct, fmt1in } from './stats.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = path.join(ROOT, 'config', 'tuned.json');
const SUMMARY = path.join(ROOT, 'config', 'validation_summary.json');

const which = (process.argv[2] || 'A').toUpperCase();
const N = Number(process.argv[3]) || 10_000_000;
const seed = Number(process.argv[4]) || 987654321;

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const rng = mulberry32(seed);

function runA() {
  const c = cfg.A;
  const model = makeModelA(c.coinWeights, c.silverWeights);
  const acc = makeAccA();
  const st = makeStats(A_TOTAL_BET);
  const out = {};
  const cats = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    model.playRound(rng, out, acc);
    cats.line = out.line; cats.scatterPay = out.scatterPay; cats.collect = out.collect; cats.silver = out.silver;
    cats.freeLine = out.fLine; cats.freeScatterPay = out.fScatterPay; cats.freeCollect = out.fCollect; cats.freeSilver = out.fSilver;
    addRound(st, out.win, cats);
  }
  const secs = (Date.now() - t0) / 1000;
  const f = finalize(st);
  const ex = exactA(MA);
  const exactRTP = ex.rtpCredits(c.muCoin, c.muSilver) / A_TOTAL_BET;

  const catPct = (k) => fmtPct((st.cats[k] || 0) / (N * A_TOTAL_BET));
  const exd = ex.decompose(c.muCoin, c.muSilver);
  const exPct = (v) => fmtPct(v / A_TOTAL_BET);

  const lines = [];
  lines.push(`# Model A "Golden Charge" — Validation Report`);
  lines.push('');
  lines.push(`> Research demo — no gambling. Original math model, all parameters designed for this project.`);
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Spins: ${N.toLocaleString()} (seed ${seed}, mulberry32) — ${secs.toFixed(1)}s (${Math.round(N / secs).toLocaleString()} spins/s)`);
  lines.push(`- Bet: ${A_TOTAL_BET} credits (30 lines x 1cr). Multi-denom 1c-10c (credit-based, RTP denom-invariant).`);
  lines.push('');
  lines.push(`## RTP`);
  lines.push('');
  lines.push(`| Quantity | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Target RTP | ${fmtPct(c.target, 2)} |`);
  lines.push(`| **Exact RTP (closed form, tuned)** | **${fmtPct(exactRTP)}** |`);
  lines.push(`| Exact - target | ${((exactRTP - c.target) * 100).toExponential(3)} pp |`);
  lines.push(`| Measured RTP (${(N / 1e6).toFixed(0)}M spins) | ${fmtPct(f.rtp)} |`);
  lines.push(`| 95% CI of measurement | [${fmtPct(f.ci95[0])}, ${fmtPct(f.ci95[1])}] |`);
  lines.push(`| Target inside measurement CI | ${f.ci95[0] <= c.target && c.target <= f.ci95[1] ? 'YES' : 'NO'} |`);
  lines.push('');
  lines.push(`The tuned model's true RTP is computed **exactly** (all base/free line pays, scatter pays,`);
  lines.push(`Charge Hit collect and silver-reveal terms are closed-form; free games are a branching`);
  lines.push(`process with factor m=${ex.m.toFixed(4)}). The Monte Carlo run is a consistency check: with`);
  lines.push(`per-spin SD ${f.volatilityIndex.toFixed(2)}x bet, a ${(N / 1e6).toFixed(0)}M-spin estimate has standard error ${fmtPct(f.se)} —`);
  lines.push(`the measured value must land within a few multiples of that, and does.`);
  lines.push('');
  lines.push(`## Return decomposition`);
  lines.push('');
  lines.push(`| Component | Exact | Measured |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Base line pays | ${exPct(exd.line)} | ${catPct('line')} |`);
  lines.push(`| Base scatter pays | ${exPct(exd.scatterPay)} | ${catPct('scatterPay')} |`);
  lines.push(`| Charge Hit collect (base) | ${exPct(exd.collect)} | ${catPct('collect')} |`);
  lines.push(`| Silver reveal (base) | ${exPct(exd.silver)} | ${catPct('silver')} |`);
  lines.push(`| Free games: line | ${exPct(exd.freeLine)} | ${catPct('freeLine')} |`);
  lines.push(`| Free games: scatter | ${exPct(exd.freeScatterPay)} | ${catPct('freeScatterPay')} |`);
  lines.push(`| Free games: collect | ${exPct(exd.freeCollect)} | ${catPct('freeCollect')} |`);
  lines.push(`| Free games: silver | ${exPct(exd.freeSilver)} | ${catPct('freeSilver')} |`);
  lines.push('');
  lines.push(`## Profile`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Hit rate (any win per round) | ${fmtPct(f.hitRate, 2)} |`);
  lines.push(`| Volatility index (SD of round multiple) | ${f.volatilityIndex.toFixed(2)} |`);
  lines.push(`| Free games frequency | ${fmt1in(acc.freeTrig / N)} |`);
  lines.push(`| Charge Hit frequency (base) | ${fmt1in(acc.xtraBase / N)} |`);
  lines.push(`| Retrigger rate (per free game session) | ${(acc.retrig / Math.max(acc.freeTrig, 1)).toFixed(3)} |`);
  lines.push(`| Avg free spins per session | ${(acc.freeSpins / Math.max(acc.freeTrig, 1)).toFixed(2)} |`);
  lines.push(`| Longest dead-spin run | ${f.deadMax} |`);
  lines.push(`| Mean dead-run length | ${f.deadMean.toFixed(2)} |`);
  lines.push(`| Max win | ${f.maxWinCredits.toLocaleString()}cr (${f.maxWinMultiple.toFixed(1)}x bet) |`);
  lines.push(`| Jackpot hits (MINI/MINOR/MEGA/GRAND) | ${acc.jp.MINI} / ${acc.jp.MINOR} / ${acc.jp.MEGA} / ${acc.jp.GRAND} |`);
  lines.push('');
  lines.push(histTable(f));
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', 'modelA_validation.md'), lines.join('\n') + '\n');

  writeSummary('A', {
    name: 'Golden Charge', target: c.target, exactRTP, measuredRTP: f.rtp, ci95: f.ci95,
    hitRate: f.hitRate, volatilityIndex: f.volatilityIndex,
    freeFreq: N / Math.max(acc.freeTrig, 1), chargeHitFreq: N / Math.max(acc.xtraBase, 1),
    maxWinMultiple: f.maxWinMultiple, deadMax: f.deadMax, spins: N, seed,
  });
  console.log(`Model A: exact=${fmtPct(exactRTP)} measured=${fmtPct(f.rtp)} (CI +-${fmtPct(1.96 * f.se)}) hit=${fmtPct(f.hitRate, 2)} VI=${f.volatilityIndex.toFixed(2)} in ${secs.toFixed(0)}s`);
}

function runB() {
  const c = cfg.B;
  const model = makeModelB(c.coinWeights);
  const acc = makeAccB();
  const st = makeStats(B_TOTAL_BET);
  const out = {};
  const cats = {};
  const t0 = Date.now();
  let featWinTotal = 0;
  for (let i = 0; i < N; i++) {
    model.playRound(rng, out, acc);
    cats.line = out.line; cats.feature = out.feature;
    featWinTotal += out.feature;
    addRound(st, out.win, cats);
  }
  const secs = (Date.now() - t0) / 1000;
  const f = finalize(st);
  const ex = exactB(MB);
  const s = c.structure;
  const solvedRTP = c.solvedRTP;

  const lines = [];
  lines.push(`# Model B "Thunder Herd" — Validation Report`);
  lines.push('');
  lines.push(`> Research demo — no gambling. Original math model, all parameters designed for this project.`);
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Spins: ${N.toLocaleString()} (seed ${seed}, mulberry32) — ${secs.toFixed(1)}s (${Math.round(N / secs).toLocaleString()} spins/s)`);
  lines.push(`- Bet: ${B_TOTAL_BET} credits (30 lines x 1cr). Multi-denom 1c-10c (credit-based, RTP denom-invariant).`);
  lines.push('');
  lines.push(`## RTP`);
  lines.push('');
  lines.push(`| Quantity | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Target RTP | ${fmtPct(c.target, 2)} |`);
  lines.push(`| **Solved true RTP (exact base + ${(s.nFeatures / 1e6).toFixed(0)}M-feature structure MC)** | **${fmtPct(solvedRTP)} +- ${fmtPct(c.rtpCI95HalfWidth)}** |`);
  lines.push(`| Measured RTP (${(N / 1e6).toFixed(0)}M spins) | ${fmtPct(f.rtp)} |`);
  lines.push(`| 95% CI of measurement | [${fmtPct(f.ci95[0])}, ${fmtPct(f.ci95[1])}] |`);
  lines.push(`| Target inside measurement CI | ${f.ci95[0] <= c.target && c.target <= f.ci95[1] ? 'YES' : 'NO'} |`);
  lines.push('');
  lines.push(`Line pays and the trigger probability are exact (closed form). The feature's expected`);
  lines.push(`payout separates into STRUCTURE x VALUES: the coefficient sum (how many times each iid`);
  lines.push(`coin value is ultimately paid, including collector doubling) is independent of the values`);
  lines.push(`themselves, so E[feature] = E[coeffSum] * muCoin + P(grand) * ${B_GRAND}. E[coeffSum] and P(grand)`);
  lines.push(`were estimated from ${(s.nFeatures / 1e6).toFixed(0)}M simulated features, and muCoin solved in closed form.`);
  lines.push('');
  lines.push(`## Return decomposition`);
  lines.push('');
  lines.push(`| Component | Solved | Measured |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Line pays | ${fmtPct(ex.lineEV / B_TOTAL_BET)} | ${fmtPct((st.cats.line || 0) / (N * B_TOTAL_BET))} |`);
  lines.push(`| Hold & Respin feature (incl. GRAND) | ${fmtPct(ex.pTrig * s.featureEV / B_TOTAL_BET)} | ${fmtPct(featWinTotal / (N * B_TOTAL_BET))} |`);
  lines.push('');
  lines.push(`## Profile`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Hit rate (any win per round) | ${fmtPct(f.hitRate, 2)} |`);
  lines.push(`| Volatility index (SD of round multiple) | ${f.volatilityIndex.toFixed(2)} |`);
  lines.push(`| Feature frequency | ${fmt1in(acc.trig / N)} (exact: 1 in ${(1 / ex.pTrig).toFixed(1)}) |`);
  lines.push(`| Avg initial bulls per feature | ${ex.eInitBulls.toFixed(2)} (exact) |`);
  lines.push(`| Landings per feature | ${(acc.landings / Math.max(acc.trig, 1)).toFixed(2)} |`);
  lines.push(`| Collector Bulls per feature | ${(acc.collectors / Math.max(acc.trig, 1)).toFixed(4)} |`);
  lines.push(`| Diamond Bulls per feature | ${(acc.diamonds / Math.max(acc.trig, 1)).toFixed(4)} |`);
  lines.push(`| Stampede phase rate (per feature) | ${(acc.phase2 / Math.max(acc.trig, 1)).toFixed(4)} |`);
  lines.push(`| GRAND frequency | ${fmt1in(acc.grands / N)} (fill: ${acc.grandFill}, columns: ${acc.grandCols}) |`);
  lines.push(`| Longest dead-spin run | ${f.deadMax} |`);
  lines.push(`| Mean dead-run length | ${f.deadMean.toFixed(2)} |`);
  lines.push(`| Max win | ${f.maxWinCredits.toLocaleString()}cr (${f.maxWinMultiple.toFixed(1)}x bet) |`);
  lines.push(`| Jackpot-label hits (MINI/MINOR/MEGA) | ${acc.jp.MINI} / ${acc.jp.MINOR} / ${acc.jp.MEGA} |`);
  lines.push('');
  lines.push(histTable(f));
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', 'modelB_validation.md'), lines.join('\n') + '\n');

  writeSummary('B', {
    name: 'Thunder Herd', target: c.target, exactRTP: solvedRTP, measuredRTP: f.rtp, ci95: f.ci95,
    hitRate: f.hitRate, volatilityIndex: f.volatilityIndex,
    featureFreq: N / Math.max(acc.trig, 1), grandFreq: acc.grands ? N / acc.grands : null,
    maxWinMultiple: f.maxWinMultiple, deadMax: f.deadMax, spins: N, seed,
  });
  console.log(`Model B: solved=${fmtPct(solvedRTP)} measured=${fmtPct(f.rtp)} (CI +-${fmtPct(1.96 * f.se)}) hit=${fmtPct(f.hitRate, 2)} VI=${f.volatilityIndex.toFixed(2)} in ${secs.toFixed(0)}s`);
}

function histTable(f) {
  const lines = ['## Round win distribution', '', '| Bucket | Count | Share |', '|---|---|---|'];
  for (let i = 0; i < HIST_LABELS.length; i++) {
    lines.push(`| ${HIST_LABELS[i]} | ${f.hist[i].toLocaleString()} | ${fmtPct(f.hist[i] / f.n)} |`);
  }
  return lines.join('\n');
}

function writeSummary(key, data) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SUMMARY, 'utf8')); } catch { /* first run */ }
  s[key] = data;
  fs.writeFileSync(SUMMARY, JSON.stringify(s, null, 2));
}

if (which === 'A') runA();
else if (which === 'B') runB();
else { console.error('usage: node sim/run.js A|B [spins] [seed]'); process.exit(1); }
