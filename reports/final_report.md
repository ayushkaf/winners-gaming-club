# Toro Math Lab — Final Report

> Research demo — no gambling. Private mathematics study; demo credits only; all artwork,
> names, copy, and parameters are original to this project.

Date: 2026-08-08 · Engines: JavaScript (Node 24 / browser, identical bundled sources) · RNG: mulberry32, seeded & reported

## 1. What was built

Two complete, playable pokie math models over a shared 5x3 / 30-line core:

| | Model A — "Golden Charge" | Model B — "Thunder Herd" |
|---|---|---|
| Architecture | Wild-collector | Hold & respin |
| Collect mechanic | 2+ Bulls: **each** Bull collects the sum of all visible Gold Coin values (2 Bulls = sum paid twice), then each Bull reveals a silver prize | 6+ Money Bulls stick; 3 respins, any landing resets to 3; Collector Bulls arrive holding the sum of everything revealed; Diamond Bulls add extra positions played in a second "Stampede phase" |
| Free games | 3/4/5 Gates → 15/20/25, boosted Bulls, retriggers | — |
| Jackpots | MINI/MINOR/MEGA/GRAND as coin/silver labels | MINI/MINOR/MEGA on bulls; GRAND (1,000x bet) by filling all 15 positions or covering all 5 columns in the Stampede phase |

Shared core (`/core`): seeded PRNG, weighted reel strips (weighting by repetition), 30-line
left-to-right evaluator with wild substitution and best-interpretation rule, coin value
system (values in credits ⇒ RTP identical across the 1c–10c denoms), multi-denom display.

## 2. Method: exact math first, Monte Carlo second

The only tuned parameters are the coin-value distributions. Everything else (strips, pays,
feature probabilities) is fixed design. That makes each model's return a **linear function
of the coin means**, which we solve in closed form:

- **Model A** is fully closed-form: line pays by exhaustive enumeration over per-reel symbol
  marginals through the same `lineWin5` the simulator runs; scatter/bull/coin window joints by
  per-stop enumeration convolved across reels; free games as a branching process
  (m = 0.1308 new spins per free spin). RTP(μ_coin, μ_silver) = fixed + C·μ_coin + S·μ_silver.
- **Model B** separates **structure from values**: the feature's payout is a random linear
  combination of iid value draws whose coefficients (how many times each draw is ultimately
  paid, including collector doubling) do not depend on the values themselves. E[coeffSum] and
  P(grand) were estimated from **16,000,000 simulated features** (SE on E[coeffSum] = 0.0013),
  line pays and trigger probability are exact, and μ_coin is then solved in closed form.

The tuner writes `config/tuned.json`; the validation harness, the browser demo, and the
dashboard all consume it. Feature mechanics were additionally verified by 21 deterministic
tests with scripted RNG (`tests/verify.js`), covering the spec's worked examples:
double-collect identity, collector-collects-all, reset-to-3, Stampede-phase extras, grid-fill
GRAND, free-game grants, and the wild-run line rules.

## 3. Results

| Metric | Golden Charge (A) | Thunder Herd (B) |
|---|---|---|
| Target RTP | 96.09% | 96.10% |
| **True RTP of tuned model** | **96.0900% (exact, closed form)** | **96.1000% ± 0.0412%** (95% CI) |
| Measured RTP | 95.9866% over 10M spins (CI ±0.539%) — target inside CI | 96.0959% over 60M spins (CI ±0.322%) — target inside CI |
| Hit rate | 33.36% | 33.60% |
| Volatility index (SD of round multiple) | 8.70 | 12.71 |
| Return in base line pays | 29.5% | 30.6% |
| Return in features | 66.6% (collect + silver + free games) | 65.5% (hold & respin incl. GRAND) |
| Main feature frequency | free games 1 in 116.7; base Charge Hit 1 in 35.7 | 1 in 121.2 (exact) |
| GRAND frequency | via silver reveal (141 hits in 10M) | ≈1 in 13,100 spins (fill dominates; column path ≈1.4% of grands) |
| Longest dead run observed | 38 | 32 |
| Max win observed | 5,123x bet | 3,669x bet |

Model A spreads feature return across frequent small collects (1-in-36 Charge Hits) plus
free-game sessions averaging 17.6 spins; Model B is the sharper design — two-thirds of its
return rides on a 1-in-121 feature averaging 79x bet with a heavy tail. Both models show the
brief's target shape: hit rates near one-in-three, long dead stretches, feature-concentrated
returns, with B clearly the more volatile (VI 12.7 vs 8.7).

### A note on the 10M-spin acceptance criterion

Hitting a target to ±0.05% cannot be *demonstrated* by a raw 10M-spin measurement when the
per-spin SD is 9–13x bet: such a measurement has a standard error of ~0.27–0.39% of bet, an
order of magnitude wider than the tolerance. The honest reading of the criterion — and what
this project delivers — is that the **true** RTP of the tuned models is within ±0.05% of
target (Model A exactly; Model B to ±0.041% at 95% confidence), and every Monte Carlo run is
statistically consistent with it. For transparency: the first Model B 10M seed (20260808)
measured 95.12%, ~2.5 SE low, driven by an unlucky GRAND count (696 vs ≈762 expected);
three further 10M seeds measured 96.23% / 95.67% / 97.08%, and the 60M run 96.0959% —
scattered around the solved value exactly as sampling theory predicts.

## 4. Documented design interpretations

Where the mechanic brief left room, these choices were made and are locked in code:

1. Coin/jackpot values are defined in credits, so RTP is identical at every denomination.
2. Model A silver reveals fire whenever 2+ Bulls are visible, even with zero coins on screen.
3. Model B's Stampede phase plays the Diamond-created extra positions **and** any still-empty
   main positions; extra positions belong to the column of the Diamond that created them.
4. The "every column" GRAND counts any Stampede-phase landing toward its column; the
   fill-all-15 GRAND can complete in either phase. The GRAND is paid at most once per feature.
5. Collector Bulls take the sum of everything revealed at the moment they land (previous
   collectors included) and then stick as a normal prize — later collectors re-collect them.

## 5. Reproduction

```
node sim/tune.js A               # closed-form solve -> config/tuned.json
node sim/tune.js B 16000000      # structure hunt + solve
node tests/verify.js             # 21 deterministic feature-math checks
node sim/run.js A 10000000 20260808
node sim/run.js B 60000000 999
node site/build.js               # bundle engines + config into site/engine.js
```

All seeds are printed in the reports; every number in this document regenerates from them.

## 6. Scope, accuracy, and limitations

- This is an original parameterisation built to publicly known return targets and publicly
  described mechanic families. No manufacturer's PAR sheets, code, artwork, or text were used
  or reproduced — so no numeric claim of similarity to any commercial machine's internals is
  made or possible. What *is* guaranteed is internal correctness: the implemented mechanics
  match this specification exactly, and the tuned returns hit their targets as stated above.
- The engines are simulation-grade, not production-gambling-grade: mulberry32 is a
  statistical PRNG, not a certified casino RNG, and nothing here implements the compliance,
  metering, or recall machinery a regulated jurisdiction requires. Operating any real-money
  implementation would require licensing and certification; this project is and stays a
  demo-credit research build.
