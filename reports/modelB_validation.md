# Model B "Thunder Herd" — Validation Report

> Research demo — no gambling. Original math model, all parameters designed for this project.

- Date: 2026-08-08T05:49:51.412Z
- Spins: 60,000,000 (seed 999, mulberry32) — 36.7s (1,636,884 spins/s)
- Bet: 30 credits (30 lines x 1cr). Multi-denom 1c-10c (credit-based, RTP denom-invariant).

## RTP

| Quantity | Value |
|---|---|
| Target RTP | 96.10% |
| **Solved true RTP (exact base + 16M-feature structure MC)** | **96.1000% +- 0.0412%** |
| Measured RTP (60M spins) | 96.0959% |
| 95% CI of measurement | [95.7744%, 96.4175%] |
| Target inside measurement CI | YES |

Line pays and the trigger probability are exact (closed form). The feature's expected
payout separates into STRUCTURE x VALUES: the coefficient sum (how many times each iid
coin value is ultimately paid, including collector doubling) is independent of the values
themselves, so E[feature] = E[coeffSum] * muCoin + P(grand) * 30000. E[coeffSum] and P(grand)
were estimated from 16M simulated features, and muCoin solved in closed form.

## Return decomposition

| Component | Solved | Measured |
|---|---|---|
| Line pays | 30.6075% | 30.6040% |
| Hold & Respin feature (incl. GRAND) | 65.4925% | 65.4919% |

## Profile

| Metric | Value |
|---|---|
| Hit rate (any win per round) | 33.60% |
| Volatility index (SD of round multiple) | 12.71 |
| Feature frequency | 1 in 121.2 (exact: 1 in 121.2) |
| Avg initial bulls per feature | 6.38 (exact) |
| Landings per feature | 2.88 |
| Collector Bulls per feature | 0.1732 |
| Diamond Bulls per feature | 0.1437 |
| Stampede phase rate (per feature) | 0.1240 |
| GRAND frequency | 1 in 13117.6 (fill: 4508, columns: 66) |
| Longest dead-spin run | 41 |
| Mean dead-run length | 2.98 |
| Max win | 95,760cr (3192.0x bet) |
| Jackpot-label hits (MINI/MINOR/MEGA) | 230505 / 114049 / 36456 |

## Round win distribution

| Bucket | Count | Share |
|---|---|---|
| loss (0) | 39,839,603 | 66.3993% |
| 0 < x <= 0.5x | 9,652,905 | 16.0882% |
| 0.5x - 1x | 4,982,223 | 8.3037% |
| 1x - 2x | 3,309,777 | 5.5163% |
| 2x - 5x | 1,497,976 | 2.4966% |
| 5x - 10x | 205,167 | 0.3419% |
| 10x - 20x | 33,101 | 0.0552% |
| 20x - 50x | 189,276 | 0.3155% |
| 50x - 100x | 202,690 | 0.3378% |
| 100x - 250x | 75,961 | 0.1266% |
| 250x - 1000x | 6,714 | 0.0112% |
| > 1000x | 4,607 | 0.0077% |
