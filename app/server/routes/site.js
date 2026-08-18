// server/routes/site.js — public marketing pages. No auth required.
//
// RTP figures, hit rate, volatility, and the validation reports themselves
// are deliberately NOT shown here — that's edge/statistics information for
// the operator, kept on the owner dashboard (server/routes/owner.js). The
// public page only shows what a player needs: how the games work and what
// they pay.
import { Router } from 'express';
import { getModelSnapshot } from '../engineBridge.js';
import { COIN_VALUES, COIN_LABELS } from '../../../core/coins.js';
import { A_PAY, A, A_SC_PAY, A_FREE_N } from '../../../models/modelA.js';
import { B_PAY, B, B_TRIGGER, B_GRAND } from '../../../models/modelB.js';

export const router = Router();

// Original, thematic symbol names — the underlying engine (models/modelA.js,
// models/modelB.js) still calls these six "A/K/Q/J/10/9" internally (they're
// just the low/mid pay tier, same as any slot's card-rank symbols), but nAmes
// shown to players use the club's own iconography instead. Ordered by pay
// tier, matching public/js/art.js's nugget/spur/lantern/wheel/canteen/lasso
// icons.
const DISPLAY_NAMES = {
  H1: 'Golden Horseshoe', H2: 'Cactus Bloom', H3: 'Canyon Mesa',
  AA: 'Gold Nugget', KK: 'Silver Spur', QQ: 'Lucky Lantern',
  JJ: 'Iron Wagon Wheel', TT: 'Leather Canteen', NN: 'Braided Lasso',
};

function payRows(PAY, sym) {
  const order = ['H1', 'H2', 'H3', 'AA', 'KK', 'QQ', 'JJ', 'TT', 'NN'];
  return order.map((key) => [DISPLAY_NAMES[key], PAY[sym[key] * 6 + 3], PAY[sym[key] * 6 + 4], PAY[sym[key] * 6 + 5]]);
}

router.get('/', (req, res) => {
  const payData = {
    a: payRows(A_PAY, A),
    b: payRows(B_PAY, B),
    coinValues: Array.from(COIN_VALUES), coinLabels: COIN_LABELS,
    scatterPay: [A_SC_PAY[3], A_SC_PAY[4], A_SC_PAY[5]], freeGames: [A_FREE_N[3], A_FREE_N[4], A_FREE_N[5]],
    bTrigger: B_TRIGGER, bGrand: B_GRAND,
  };
  res.render('home', { title: 'Winners Gaming Club — Club Credit Slots', user: req.user, snapshot: getModelSnapshot(), payData });
});

router.get('/responsible-play', (req, res) => {
  res.render('responsible_play', { title: 'Need help with gambling?', user: req.user, activeNav: 'responsible' });
});
