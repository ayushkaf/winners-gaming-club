# Model A "Golden Charge" — Validation Report

> Research demo — no gambling. Original math model, all parameters designed for this project.

- Date: 2026-08-08T05:48:00.414Z
- Spins: 10,000,000 (seed 20260808, mulberry32) — 8.8s (1,139,341 spins/s)
- Bet: 30 credits (30 lines x 1cr). Multi-denom 1c-10c (credit-based, RTP denom-invariant).

## RTP

| Quantity | Value |
|---|---|
| Target RTP | 96.09% |
| **Exact RTP (closed form, tuned)** | **96.0900%** |
| Exact - target | 0.000e+0 pp |
| Measured RTP (10M spins) | 95.9866% |
| 95% CI of measurement | [95.4475%, 96.5257%] |
| Target inside measurement CI | YES |

The tuned model's true RTP is computed **exactly** (all base/free line pays, scatter pays,
Charge Hit collect and silver-reveal terms are closed-form; free games are a branching
process with factor m=0.1308). The Monte Carlo run is a consistency check: with
per-spin SD 8.70x bet, a 10M-spin estimate has standard error 0.2750% —
the measured value must land within a few multiples of that, and does.

## Return decomposition

| Component | Exact | Measured |
|---|---|---|
| Base line pays | 29.5096% | 29.5002% |
| Base scatter pays | 2.1700% | 2.1782% |
| Charge Hit collect (base) | 11.8034% | 11.7691% |
| Silver reveal (base) | 9.9526% | 9.9075% |
| Free games: line | 8.6461% | 8.6640% |
| Free games: scatter | 0.3264% | 0.3298% |
| Free games: collect | 22.8477% | 22.7559% |
| Free games: silver | 10.8342% | 10.8819% |

## Profile

| Metric | Value |
|---|---|
| Hit rate (any win per round) | 33.36% |
| Volatility index (SD of round multiple) | 8.70 |
| Free games frequency | 1 in 116.7 |
| Charge Hit frequency (base) | 1 in 35.7 |
| Retrigger rate (per free game session) | 0.151 |
| Avg free spins per session | 17.58 |
| Longest dead-spin run | 38 |
| Mean dead-run length | 3.00 |
| Max win | 153,692cr (5123.1x bet) |
| Jackpot hits (MINI/MINOR/MEGA/GRAND) | 29612 / 13236 / 3701 / 141 |

## Round win distribution

| Bucket | Count | Share |
|---|---|---|
| loss (0) | 6,663,816 | 66.6382% |
| 0 < x <= 0.5x | 1,561,107 | 15.6111% |
| 0.5x - 1x | 720,674 | 7.2067% |
| 1x - 2x | 530,098 | 5.3010% |
| 2x - 5x | 259,389 | 2.5939% |
| 5x - 10x | 113,700 | 1.1370% |
| 10x - 20x | 57,760 | 0.5776% |
| 20x - 50x | 57,542 | 0.5754% |
| 50x - 100x | 26,111 | 0.2611% |
| 100x - 250x | 9,034 | 0.0903% |
| 250x - 1000x | 681 | 0.0068% |
| > 1000x | 88 | 0.0009% |
