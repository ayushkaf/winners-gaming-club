// core/prng.js — seedable PRNG (mulberry32). Deterministic, fast, good enough
// statistical quality for slot simulation (passes gjrand smoke tests; period 2^32
// per stream — we use distinct seeds per run and report the seed for reproducibility).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Splits one seed into k independent streams (used so cosmetic draws in the demo
// UI never disturb the outcome stream).
export function seededStreams(seed, k) {
  const root = mulberry32(seed ^ 0x9e3779b9);
  const out = [];
  for (let i = 0; i < k; i++) out.push(mulberry32((root() * 4294967296) >>> 0));
  return out;
}
