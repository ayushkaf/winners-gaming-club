// server/routes/user.js — account/support pages available to any logged-in user.
import { Router } from 'express';
import { requireAuth, requireRole, hashPassword, verifyPassword } from '../auth.js';
import { getBalance } from '../ledger.js';
import { db, log } from '../db.js';
import { getLimits, setLimits, todayNetLoss } from '../limits.js';

export const router = Router();

// ---------------------------------------------------------------- profile (all roles)
// One settings hub instead of scattered controls: password change for every
// role, plus — for players only, since staff don't spin — their own
// responsible-play limits and a plain win/loss summary.
function winLossSummary(userId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'spin_stake' THEN -amount ELSE 0 END), 0) AS staked,
      COALESCE(SUM(CASE WHEN type = 'spin_win' THEN amount ELSE 0 END), 0) AS won,
      SUM(CASE WHEN type = 'spin_stake' THEN 1 ELSE 0 END) AS spins,
      SUM(CASE WHEN type = 'spin_win' AND amount > 0 THEN 1 ELSE 0 END) AS winningSpins
    FROM ledger WHERE user_id = ?
  `).get(userId);
  return { ...row, net: row.won - row.staked };
}

router.get('/profile', requireAuth, (req, res) => {
  const isPlayer = req.user.role === 'user';
  res.render('profile', {
    title: 'Profile', user: req.user, activeNav: 'profile',
    passwordError: null, passwordSaved: req.query.passwordSaved === '1',
    isPlayer,
    limits: isPlayer ? getLimits(req.user.id) : null,
    todayNetLoss: isPlayer ? todayNetLoss(req.user.id) : null,
    summary: isPlayer ? winLossSummary(req.user.id) : null,
    limitsError: null, limitsSaved: req.query.limitsSaved === '1',
  });
});

router.post('/profile/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const isPlayer = req.user.role === 'user';
  const fail = (passwordError) => res.status(400).render('profile', {
    title: 'Profile', user: req.user, activeNav: 'profile', passwordError, passwordSaved: false, isPlayer,
    limits: isPlayer ? getLimits(req.user.id) : null, todayNetLoss: isPlayer ? todayNetLoss(req.user.id) : null,
    summary: isPlayer ? winLossSummary(req.user.id) : null, limitsError: null, limitsSaved: false,
  });
  if (!newPassword || newPassword.length < 8) return fail('New password must be at least 8 characters.');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(currentPassword || '', row.password_hash))) return fail('Current password is incorrect.');
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  log('info', 'profile', 'password changed', { userId: req.user.id });
  res.redirect('/profile?passwordSaved=1');
});

// Available to any role that has someone above them to talk to: a player
// talks to their admin, an admin talks to the developer who created them, a
// developer talks to the owner who created them. Owner has no /chat of their
// own — they're the top of the hierarchy, nobody manages them.
const MANAGER_NOUN = { user: 'Admin', admin: 'Developer', developer: 'Owner' };
router.get('/chat', requireAuth, requireRole('user', 'admin', 'developer'), (req, res) => {
  res.render('chat', {
    title: 'Support chat', user: req.user, balance: req.user.role === 'user' ? getBalance(req.user.id) : undefined,
    isStaff: false, watchUserId: req.user.id, assignedStaffId: req.user.assigned_staff_id,
    managerNoun: MANAGER_NOUN[req.user.role], activeNav: 'chat',
  });
});

router.get('/account', requireAuth, (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS totalEntries,
      SUM(CASE WHEN type = 'spin_stake' THEN 1 ELSE 0 END) AS spins,
      SUM(CASE WHEN type = 'spin_win' AND amount > 0 THEN 1 ELSE 0 END) AS wins
    FROM ledger WHERE user_id = ?
  `).get(req.user.id);
  res.render('account', {
    title: 'My account', user: req.user, balance: getBalance(req.user.id), stats,
    funded: req.query.funded === '1', activeNav: 'account',
    limits: getLimits(req.user.id), todayNetLoss: todayNetLoss(req.user.id), limitsError: null, limitsSaved: req.query.limitsSaved === '1',
  });
});

// Self-service responsible-play controls. A player may only tighten these —
// set/extend a pause, or set/lower a daily loss cap — never loosen or clear
// one early; that requires a conversation with support (an admin can do it
// from /admin/users/:id). Same server-authoritative rule as every balance
// check elsewhere: the client can suggest a value, only the server decides
// whether it's allowed to apply.
router.post('/account/limits', requireAuth, requireRole('user'), (req, res) => {
  const current = getLimits(req.user.id);
  const { pauseUntil, dailyLossLimit, clearAction } = req.body;
  const fail = (limitsError) => res.status(400).render('account', {
    title: 'My account', user: req.user, balance: getBalance(req.user.id),
    stats: db.prepare(`SELECT COUNT(*) AS totalEntries, SUM(CASE WHEN type = 'spin_stake' THEN 1 ELSE 0 END) AS spins, SUM(CASE WHEN type = 'spin_win' AND amount > 0 THEN 1 ELSE 0 END) AS wins FROM ledger WHERE user_id = ?`).get(req.user.id),
    funded: false, activeNav: 'account', limits: current, todayNetLoss: todayNetLoss(req.user.id), limitsError, limitsSaved: false,
  });

  if (clearAction) {
    // Players can always ask support to remove a limit early — this button
    // just opens that conversation rather than clearing it unilaterally.
    return res.redirect('/chat');
  }

  let selfExcludeUntil = current.self_exclude_until || null;
  if (pauseUntil) {
    const next = new Date(pauseUntil);
    if (Number.isNaN(next.getTime())) return fail('Enter a valid date for your break.');
    if (current.self_exclude_until && next <= new Date(current.self_exclude_until)) {
      return fail('A break can only be extended further out, not shortened — message support to shorten one.');
    }
    selfExcludeUntil = next.toISOString();
  }

  let dailyLossLimitVal = current.daily_loss_limit;
  if (dailyLossLimit) {
    const n = Math.round(Number(dailyLossLimit));
    if (!Number.isFinite(n) || n <= 0) return fail('Enter a positive whole number for your daily loss limit.');
    if (current.daily_loss_limit != null && n > current.daily_loss_limit) {
      return fail('A daily loss limit can only be lowered, not raised — message support to raise it.');
    }
    dailyLossLimitVal = n;
  }

  setLimits(req.user.id, { selfExcludeUntil, dailyLossLimit: dailyLossLimitVal }, req.user.id, 'user');
  log('info', 'user', 'player set own responsible-play limit', { userId: req.user.id, selfExcludeUntil, dailyLossLimit: dailyLossLimitVal });
  res.redirect('/account?limitsSaved=1');
});
