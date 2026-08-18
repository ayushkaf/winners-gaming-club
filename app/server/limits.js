// server/limits.js — responsible-play controls: a player can pause their own
// play or cap their daily losses, and their assigned admin can do the same on
// their behalf (e.g. after a support conversation). Enforced at spin time in
// server/routes/play.js, same "server is the only authority" rule as every
// other balance check in this app.
import { db, log } from './db.js';

export function getLimits(userId) {
  return db.prepare('SELECT self_exclude_until, daily_loss_limit FROM users WHERE id = ?').get(userId);
}

export function setLimits(userId, { selfExcludeUntil, dailyLossLimit }, actorId, actorRole) {
  db.prepare('UPDATE users SET self_exclude_until = ?, daily_loss_limit = ? WHERE id = ?')
    .run(selfExcludeUntil || null, Number.isFinite(dailyLossLimit) ? Math.round(dailyLossLimit) : null, userId);
  log('info', 'limits', 'responsible-play limits updated', { userId, selfExcludeUntil, dailyLossLimit, actorId, actorRole });
}

// Net credits lost so far today (stakes minus wins). Positive = net loss;
// zero or negative = break-even or up. Compared against daily_loss_limit.
export function todayNetLoss(userId) {
  const row = db.prepare(`
    SELECT COALESCE(-SUM(amount), 0) AS netLoss
    FROM ledger
    WHERE user_id = ? AND type IN ('spin_stake', 'spin_win')
      AND ts >= strftime('%Y-%m-%dT00:00:00.000Z', 'now', 'start of day')
  `).get(userId);
  return row.netLoss;
}

// Returns a player-facing reason to block play right now, or null if play is
// allowed. Checked fresh on every page load and every spin — never cached.
export function playBlockReason(userId) {
  const limits = getLimits(userId);
  if (!limits) return null;
  if (limits.self_exclude_until && new Date(limits.self_exclude_until) > new Date()) {
    return `You've paused play until ${new Date(limits.self_exclude_until).toLocaleString()}. Support can talk through it any time.`;
  }
  if (limits.daily_loss_limit != null && todayNetLoss(userId) >= limits.daily_loss_limit) {
    return `You've reached your daily loss limit (${limits.daily_loss_limit.toLocaleString()} credits). It resets at midnight — reach out to support if you'd like to adjust it.`;
  }
  return null;
}
