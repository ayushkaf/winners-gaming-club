// server/routes/play.js — the only place a spin gets resolved. Every request
// re-derives the balance from the ledger, validates server-side, then writes
// the stake and (if any) win as ledger rows inside one transaction. Only
// role='user' accounts may play — staff accounts (admin/developer/owner)
// manage the platform but don't spin on it.
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { getConfig } from '../db.js';
import { getBalance, resolveSpin, history, InsufficientBalanceError } from '../ledger.js';
import { playRoundA, playRoundB, getModelSnapshot, DEFAULT_MIN_BET, DEFAULT_MAX_BET } from '../engineBridge.js';
import { playBlockReason } from '../limits.js';

export const router = Router();

function betRange() {
  return {
    min: Number(getConfig('min_bet') || DEFAULT_MIN_BET),
    max: Number(getConfig('max_bet') || DEFAULT_MAX_BET),
  };
}

router.get('/play', requireAuth, requireRole('user'), (req, res) => {
  res.render('play', {
    title: 'Play — Winners Gaming Club',
    user: req.user,
    balance: getBalance(req.user.id),
    welcome: req.query.welcome === '1',
    snapshot: getModelSnapshot(),
    modelAEnabled: getConfig('model_a_enabled') !== 'false',
    modelBEnabled: getConfig('model_b_enabled') !== 'false',
    betRange: betRange(),
    blockReason: playBlockReason(req.user.id),
    activeNav: 'play',
  });
});

router.get('/api/play/state', requireAuth, requireRole('user'), (req, res) => {
  res.json({
    balance: getBalance(req.user.id),
    snapshot: getModelSnapshot(),
    modelAEnabled: getConfig('model_a_enabled') !== 'false',
    modelBEnabled: getConfig('model_b_enabled') !== 'false',
    betRange: betRange(),
    blockReason: playBlockReason(req.user.id),
  });
});

router.post('/api/play/spin', requireAuth, requireRole('user'), (req, res) => {
  const blockReason = playBlockReason(req.user.id);
  if (blockReason) return res.status(423).json({ error: blockReason });

  const { model, totalBet } = req.body || {};
  if (model !== 'A' && model !== 'B') return res.status(400).json({ error: 'model must be A or B' });
  const bet = Math.round(Number(totalBet));
  const { min, max } = betRange();
  if (!Number.isFinite(bet) || bet < min || bet > max) {
    return res.status(400).json({ error: `Bet must be a whole number between ${min} and ${max} Club Credits.` });
  }

  const enabledKey = model === 'A' ? 'model_a_enabled' : 'model_b_enabled';
  if (getConfig(enabledKey) === 'false') return res.status(423).json({ error: `${model === 'A' ? 'Golden Charge' : 'Thunder Herd'} is temporarily unavailable.` });

  const balanceBefore = getBalance(req.user.id);
  if (balanceBefore < bet) {
    return res.status(402).json({ error: 'Not enough Club Credits for this bet.', balance: balanceBefore, stakeNeeded: bet });
  }

  const round = model === 'A' ? playRoundA(bet) : playRoundB(bet);
  try {
    const balanceAfter = resolveSpin(req.user.id, model, round.stake, round.win, round.roundId);
    res.json({ ...round, balanceBefore, balanceAfter });
  } catch (e) {
    if (e instanceof InsufficientBalanceError) {
      return res.status(402).json({ error: 'Not enough Club Credits for this bet.', balance: getBalance(req.user.id) });
    }
    throw e;
  }
});

router.get('/api/play/history', requireAuth, (req, res) => {
  res.json({ entries: history(req.user.id, 300) });
});

router.get('/history', requireAuth, (req, res) => {
  res.render('history', { title: 'Transaction history', user: req.user, entries: history(req.user.id, 500), balance: getBalance(req.user.id) });
});
