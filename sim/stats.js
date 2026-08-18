// sim/stats.js — round-level statistics accumulator for Monte Carlo runs.
// A "round" = one paid spin plus everything it triggers (free games / feature).

export const HIST_EDGES = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 1000, Infinity];
export const HIST_LABELS = [
  'loss (0)', '0 < x <= 0.5x', '0.5x - 1x', '1x - 2x', '2x - 5x', '5x - 10x',
  '10x - 20x', '20x - 50x', '50x - 100x', '100x - 250x', '250x - 1000x', '> 1000x',
];

export function makeStats(bet) {
  return {
    bet,
    n: 0,
    totalWin: 0,
    sum: 0,      // sum of round multiples (win/bet)
    sumsq: 0,    // sum of squared multiples
    hits: 0,
    maxWin: 0,
    deadCur: 0,
    deadMax: 0,
    deadSum: 0,  // total length of completed dead runs
    deadRuns: 0,
    hist: new Float64Array(HIST_LABELS.length),
    cats: {},    // category -> total credits
  };
}

export function addRound(st, win, cats) {
  st.n++;
  st.totalWin += win;
  const m = win / st.bet;
  st.sum += m;
  st.sumsq += m * m;
  if (win > 0) {
    st.hits++;
    if (st.deadCur > 0) { st.deadRuns++; st.deadSum += st.deadCur; if (st.deadCur > st.deadMax) st.deadMax = st.deadCur; st.deadCur = 0; }
  } else {
    st.deadCur++;
    st.hist[0]++;
  }
  if (win > 0) {
    let b = 1;
    while (b < HIST_EDGES.length - 1 && m > HIST_EDGES[b]) b++;
    st.hist[b]++;
  }
  if (win > st.maxWin) st.maxWin = win;
  if (cats) for (const k in cats) st.cats[k] = (st.cats[k] || 0) + cats[k];
}

export function finalize(st) {
  const mean = st.sum / st.n;                       // RTP as a fraction
  const varr = st.sumsq / st.n - mean * mean;        // per-round variance of multiple
  const sd = Math.sqrt(Math.max(varr, 0));           // volatility index (SD of round multiple)
  const se = sd / Math.sqrt(st.n);
  if (st.deadCur > 0) { st.deadRuns++; st.deadSum += st.deadCur; if (st.deadCur > st.deadMax) st.deadMax = st.deadCur; st.deadCur = 0; }
  return {
    n: st.n,
    rtp: mean,
    se,
    ci95: [mean - 1.96 * se, mean + 1.96 * se],
    hitRate: st.hits / st.n,
    volatilityIndex: sd,
    maxWinCredits: st.maxWin,
    maxWinMultiple: st.maxWin / st.bet,
    deadMax: st.deadMax,
    deadMean: st.deadRuns ? st.deadSum / st.deadRuns : 0,
    hist: Array.from(st.hist),
    cats: st.cats,
  };
}

export function fmtPct(x, dp = 4) { return (100 * x).toFixed(dp) + '%'; }
export function fmt1in(p) { return p > 0 ? '1 in ' + (1 / p).toFixed(1) : 'never observed'; }
