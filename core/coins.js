// core/coins.js — the Gold Coin value system shared by both models.
//
// A coin (or money-bull) that lands carries a credit value drawn from a weighted
// distribution, or one of four jackpot labels. All values are expressed in
// CREDITS at the reference bet of 30 credits (30 lines x 1 credit). Because coin
// values are defined in credits, RTP is identical at every denomination
// (1c / 2c / 5c / 10c) — a deliberate modelling choice, documented in the report.
//
// The tuner does not invent values; it only re-weights this fixed value list by
// interpolating between a "low" and a "high" weight profile until the
// distribution mean equals the exact mean the closed-form RTP solve requires.

export const COIN_VALUES = [
  15, 20, 25, 30, 40, 50, 60, 90, 120, 150, 200, 300, 450, 600, // plain credit prizes
  300, 750, 3000, 30000, // MINI, MINOR, MEGA, GRAND
];
export const COIN_LABELS = [
  null, null, null, null, null, null, null, null, null, null, null, null, null, null,
  'MINI', 'MINOR', 'MEGA', 'GRAND',
];
export const N_COIN = COIN_VALUES.length;
export const JACKPOT_CREDITS = { MINI: 300, MINOR: 750, MEGA: 3000, GRAND: 30000 };

// Weight profiles. LOW is bottom-heavy (mean ~40cr), HIGH is top-heavy (mean ~200cr).
// The tuned distribution is w(t) = (1-t)*LOW + t*HIGH for t in [0,1].
export const A_COIN_LOW = [30, 26, 22, 18, 14, 10, 8, 5, 3, 2, 1, 0.5, 0.25, 0.1, 0.5, 0.15, 0.03, 0.003];
export const A_COIN_HIGH = [2, 2, 3, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 4, 2, 0.6, 0.02];

// Silver-coin reveal (Model A: each Bull transforms after collecting). Slightly
// flatter than the gold profile, with a marginally richer jackpot slice.
export const A_SILVER_LOW = [28, 24, 20, 17, 14, 11, 9, 6, 4, 2.5, 1.5, 0.8, 0.4, 0.2, 0.8, 0.25, 0.05, 0.004];
export const A_SILVER_HIGH = [2, 2, 3, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 5, 2.5, 0.8, 0.03];

// Model B money-bull values: the GRAND is never on a coin — it is only won by
// filling the grid or covering all five columns in the Stampede phase. The HIGH
// profile is toppier than Model A's (hold & respin games carry chunkier values).
export const B_COIN_LOW = A_COIN_LOW.slice(); B_COIN_LOW[17] = 0;
export const B_COIN_HIGH = [1.5, 1.5, 2, 3, 4, 5, 6, 7, 8, 8, 7.5, 7, 6, 5, 5, 2.5, 0.8, 0];

export function distMean(weights) {
  let sw = 0, swv = 0;
  for (let i = 0; i < N_COIN; i++) { sw += weights[i]; swv += weights[i] * COIN_VALUES[i]; }
  return swv / sw;
}

export function lerpWeights(low, high, t) {
  const w = new Array(N_COIN);
  for (let i = 0; i < N_COIN; i++) w[i] = (1 - t) * low[i] + t * high[i];
  return w;
}

// Find t so that mean(w(t)) === targetMean. mean(t) is continuous and monotone
// for our profiles; bisection to 1e-12 gives an exact-to-double-precision mean.
export function solveWeightsForMean(low, high, targetMean) {
  const mLow = distMean(low), mHigh = distMean(high);
  if (targetMean < Math.min(mLow, mHigh) || targetMean > Math.max(mLow, mHigh)) {
    throw new Error(`target mean ${targetMean.toFixed(3)} outside profile range [${mLow.toFixed(3)}, ${mHigh.toFixed(3)}]`);
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const m = distMean(lerpWeights(low, high, mid));
    if ((m < targetMean) === (mLow < mHigh)) lo = mid; else hi = mid;
  }
  return lerpWeights(low, high, (lo + hi) / 2);
}

// Cumulative-weight drawer. draw(rngFloat) returns an index into COIN_VALUES.
export function makeDrawer(weights) {
  const cum = new Float64Array(N_COIN);
  let t = 0;
  for (let i = 0; i < N_COIN; i++) { t += weights[i]; cum[i] = t; }
  const total = t;
  return {
    mean: distMean(weights),
    weights,
    draw(rng) {
      const u = rng() * total;
      let i = 0;
      while (cum[i] < u) i++;
      return i;
    },
  };
}
