// server/ledger.js — the only code allowed to write to `ledger`. Balance is
// always SUM(amount); nothing else in the app is permitted to hold or trust a
// cached balance across a request boundary.
import { db, log } from './db.js';

export class InsufficientBalanceError extends Error {
  constructor(have, need) {
    super(`insufficient balance: have ${have}, need ${need}`);
    this.name = 'InsufficientBalanceError';
    this.have = have;
    this.need = need;
  }
}

export function getBalance(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS bal FROM ledger WHERE user_id = ?').get(userId);
  return row.bal;
}

// Runs `fn` inside a SQLite transaction (BEGIN IMMEDIATE takes the write lock
// up front, so two concurrent spins for the same user serialize instead of
// racing on the balance check).
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const insertRow = db.prepare(`
  INSERT INTO ledger (user_id, type, amount, reason, admin_id, model, round_id, resulting_balance)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// Writes one immutable ledger row and returns the new balance. Never call
// outside a transaction() if it must be atomic with other writes.
function writeEntry(userId, type, amount, { reason = null, adminId = null, model = null, roundId = null } = {}) {
  const before = getBalance(userId);
  const after = before + amount;
  if (after < 0) throw new InsufficientBalanceError(before, -amount);
  insertRow.run(userId, type, amount, reason, adminId, model, roundId, after);
  return after;
}

// Fixed and non-configurable by design — every new player gets exactly this,
// no more, no less, and nothing in the signup form can change it.
export const SIGNUP_BONUS_CREDITS = 20;
export function creditFixedSignupBonus(userId) {
  return transaction(() => {
    const after = writeEntry(userId, 'signup_bonus', SIGNUP_BONUS_CREDITS, { reason: `Signup bonus (fixed ${SIGNUP_BONUS_CREDITS} credits)` });
    log('info', 'ledger', 'signup bonus credited', { userId, granted: SIGNUP_BONUS_CREDITS });
    return after;
  });
}

// Tier-agnostic "reload / take out" — used identically at every level of the
// hierarchy (admin<->user, developer<->admin, owner<->developer/admin).
// Giving credits (positive amount) is a real transfer sourced from the
// acting staff member's OWN float, balance-checked exactly like /wallet — it
// can never create credits from nothing (see the supply-chain comment below:
// the owner mint is the only place credits are ever created). Taking credits
// out (negative amount) is the exact mirror: it's a real transfer from the
// target's float BACK to the acting staff member's own float, balance-
// checked against what the target actually has — never destroyed, never
// created, just moved, same as every other transfer in this system.
export function adminAdjust(targetId, amount, reason, actorId) {
  if (!reason || !reason.trim()) throw new Error('reason is required for a manual adjustment');
  if (amount > 0) return transferCredits(actorId, targetId, amount, reason, actorId, 'admin_adjust');
  return transferCredits(targetId, actorId, -amount, reason, actorId, 'admin_adjust');
}

// Shared by every "reload / take out" route (admin<->user, developer<->admin,
// owner<->developer/admin) — turns a caught error from adminAdjust() into a
// plain-language message. Which side's balance was insufficient depends on
// the direction: giving checks the actor's own float, taking out checks the
// target's.
export function adjustErrorMessage(e, amount) {
  if (e instanceof InsufficientBalanceError) {
    return amount > 0
      ? `Your own float only has ${e.have.toLocaleString()} credits — not enough to give ${amount.toLocaleString()}. Get more from whoever manages you first.`
      : `This account only has ${e.have.toLocaleString()} credits — not enough to take out ${(-amount).toLocaleString()}.`;
  }
  return e.message;
}

// ---------------------------------------------------------------------
// The demo-credit supply chain: Owner mints from nothing into their own
// float; every other credit anyone ever holds arrived via a balance-checked
// transfer down the chain (Owner -> Developer/Admin/User, Developer ->
// Admin/User, Admin -> User). Nobody in this chain can hand out more than
// they've actually received — the same InsufficientBalanceError guard that
// protects spins protects every transfer here too.
// ---------------------------------------------------------------------

// Owner-only in practice (enforced at the route layer, same pattern as every
// other ledger function here) — creates credits that didn't exist before,
// fully audited as their own distinct, searchable ledger type.
export function ownerMint(ownerId, amount, note, actorId) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('mint amount must be a positive whole number');
  return transaction(() => {
    const after = writeEntry(ownerId, 'owner_mint', Math.round(amount), { reason: note?.trim() || 'Owner mint', adminId: actorId });
    log('info', 'ledger', 'owner minted credits', { ownerId, amount, actorId });
    return after;
  });
}

// Moves credits from one account's float to another's, atomically, checked
// against the sender's real balance. `type` distinguishes a plain internal
// transfer from a simulated payment-method purchase in the ledger UI —
// both are the exact same mechanic underneath.
export function transferCredits(fromId, toId, amount, note, actorId, type = 'staff_transfer') {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('transfer amount must be a positive whole number');
  if (fromId === toId) throw new Error('cannot transfer to the same account');
  return transaction(() => {
    const amt = Math.round(amount);
    writeEntry(fromId, type, -amt, { reason: note?.trim() || 'Transfer out', adminId: actorId });
    const after = writeEntry(toId, type, amt, { reason: note?.trim() || 'Transfer in', adminId: actorId });
    log('info', 'ledger', 'credits transferred', { fromId, toId, amount: amt, type, actorId });
    return after;
  });
}

export function mintedTotal() {
  return db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE type = 'owner_mint'").get().s;
}

// Stakes a spin (negative entry) then applies the result (positive entry, if
// any) atomically, so a crash mid-spin can never leave a stake deducted with
// no resolution recorded. Throws InsufficientBalanceError if the stake alone
// would go negative — caller must not have resolved a spin yet at that point.
export function resolveSpin(userId, model, stake, winAmount, roundId) {
  return transaction(() => {
    writeEntry(userId, 'spin_stake', -stake, { model, roundId });
    const after = winAmount > 0
      ? writeEntry(userId, 'spin_win', winAmount, { model, roundId })
      : getBalance(userId);
    return after;
  });
}

export function history(userId, limit = 200) {
  return db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}

// staffId: when given, only shows activity for players assigned to that
// staff member (a plain admin's scoped view). Omit for developer/owner, who
// see everything.
export function allRecentLedger(limit = 500, staffId = null) {
  if (staffId) {
    return db.prepare(`
      SELECT ledger.*, u.email AS user_email, a.email AS admin_email
      FROM ledger
      JOIN users u ON u.id = ledger.user_id
      LEFT JOIN users a ON a.id = ledger.admin_id
      WHERE u.assigned_staff_id = ?
      ORDER BY ledger.id DESC LIMIT ?
    `).all(staffId, limit);
  }
  return db.prepare(`
    SELECT ledger.*, u.email AS user_email, a.email AS admin_email
    FROM ledger
    JOIN users u ON u.id = ledger.user_id
    LEFT JOIN users a ON a.id = ledger.admin_id
    ORDER BY ledger.id DESC LIMIT ?
  `).all(limit);
}

// Recomputes SUM(amount) for every user and compares it against each row's
// own resulting_balance snapshot at the time it was written. Returns a report
// used by both the owner dashboard and the standalone integrity test.
export function verifyIntegrity() {
  const users = db.prepare('SELECT id, email FROM users').all();
  const problems = [];
  for (const u of users) {
    const rows = db.prepare('SELECT amount, resulting_balance FROM ledger WHERE user_id = ? ORDER BY id ASC').all(u.id);
    let running = 0;
    for (const r of rows) {
      running += r.amount;
      if (running !== r.resulting_balance) {
        problems.push({ userId: u.id, email: u.email, expected: running, snapshot: r.resulting_balance });
        break;
      }
    }
    const finalBalance = getBalance(u.id);
    if (finalBalance !== running) {
      problems.push({ userId: u.id, email: u.email, note: 'SUM(amount) mismatch vs running total', finalBalance, running });
    }
    if (finalBalance < 0) problems.push({ userId: u.id, email: u.email, note: 'NEGATIVE BALANCE', finalBalance });
  }
  return { checkedUsers: users.length, ok: problems.length === 0, problems };
}
