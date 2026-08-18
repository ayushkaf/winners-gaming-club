// server/routes/admin.js — Tier 2 (admin), scoped strictly to the role='user'
// players assigned to their own Staff ID, plus the operational half of Tier 1
// (developer), who manages only the admins assigned to THEM — never users
// directly. Managing admin/developer/owner accounts is owner-only for the
// unrestricted case (server/routes/owner.js); a developer's own scoped
// version of "create/disable my admins" lives here instead.
import { Router } from 'express';
import { requireRole, hashPassword, generateTempPassword } from '../auth.js';
import { db, log, nextStaffId } from '../db.js';
import { getBalance, history, adminAdjust, adjustErrorMessage } from '../ledger.js';
import { getModelSnapshot } from '../engineBridge.js';
import { getLimits, setLimits, todayNetLoss } from '../limits.js';

export const router = Router();
// Scoped to '/admin*' — every route in this file starts with that prefix.
// Without the path argument, router.use() runs for EVERY request that
// reaches this router (it's mounted at the app root), which would silently
// gate unrelated later-mounted routes too — that exact bug bit /wallet via
// owner.js's equivalent blanket check.
router.use('/admin', requireRole('admin', 'developer', 'owner'));
// User-level management is admin-only now — owner manages developers/admins,
// not individual players, and a developer manages admins, never users.
router.use('/admin/users', requireRole('admin'));
// Platform-wide stats (registered users, credits in circulation, live RTP)
// are owner-only, hard rule — not even the admins generating that activity
// get to see the aggregate picture, only their own scoped slice of it.
router.use('/admin/analytics', requireRole('owner'));

// Plain admins only see players assigned to their own Staff ID; owner has
// cross-admin visibility. (Developers never reach these routes at all now —
// see adminOrOwnerOnly above.)
const isScoped = (req) => req.user.role === 'admin';

// Transfer targets are admins only — developers don't manage users, so a
// player can never be routed to one.
function activeStaff() {
  return db.prepare("SELECT staff_id, display_name, role FROM users WHERE role = 'admin' AND disabled = 0 AND staff_id IS NOT NULL ORDER BY staff_id").all();
}

function analyticsSnapshot() {
  const totalUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n;
  const activeToday = db.prepare(`
    SELECT COUNT(DISTINCT user_id) AS n FROM ledger
    WHERE type IN ('spin_stake') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now','-24 hours'))
  `).get().n;
  const circulating = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM ledger').get().s;
  const byModel = db.prepare(`
    SELECT model,
      SUM(CASE WHEN type = 'spin_stake' THEN 1 ELSE 0 END) AS spins,
      SUM(CASE WHEN type = 'spin_stake' THEN -amount ELSE 0 END) AS staked,
      SUM(CASE WHEN type = 'spin_win' THEN amount ELSE 0 END) AS won
    FROM ledger WHERE model IS NOT NULL GROUP BY model
  `).all();
  const snapshot = getModelSnapshot();
  const models = byModel.map((m) => ({
    model: m.model,
    spins: m.spins,
    staked: m.staked,
    won: m.won,
    liveRTP: m.staked > 0 ? m.won / m.staked : null,
    targetRTP: m.model === 'A' ? snapshot.A.exactRTP : snapshot.B.solvedRTP,
    name: m.model === 'A' ? snapshot.A.name : snapshot.B.name,
  }));
  return { totalUsers, activeToday, circulating, models };
}

// A developer's admins: only the ones assigned to (created under) their own
// Staff ID — never another developer's, and never a raw user list at all.
function myAdmins(developerStaffId) {
  const rows = db.prepare(`
    SELECT id, staff_id, display_name, email, disabled, created_at,
      (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'user' AND u2.assigned_staff_id = users.staff_id) AS playerCount
    FROM users WHERE role = 'admin' AND assigned_staff_id = ? ORDER BY id DESC
  `).all(developerStaffId);
  return rows.map((r) => ({ ...r, balance: getBalance(r.id) }));
}

router.get('/admin', (req, res) => {
  if (req.user.role === 'developer') {
    return res.render('admin/dev_dashboard', { title: 'Developer dashboard', user: req.user, balance: getBalance(req.user.id), admins: myAdmins(req.user.staff_id), activeNav: 'admin', tempPassword: null, tempPasswordFor: null });
  }
  res.render('admin/dashboard', { title: 'Admin dashboard', user: req.user, balance: getBalance(req.user.id), activeNav: 'admin' });
});

// ---------------------------------------------------------------- developer: my admins (scoped, mutually isolated)
function loadMyAdmin(req, res) {
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(Number(req.params.id));
  if (!target || target.assigned_staff_id !== req.user.staff_id) {
    res.status(404).render('error', { title: 'Not found', message: 'No such admin under your account.', user: req.user });
    return null;
  }
  return target;
}

router.get('/admin/my-admins/new', requireRole('developer'), (req, res) => {
  res.render('admin/admin_new', { title: 'Create admin', user: req.user, error: null, form: {} });
});

router.post('/admin/my-admins/new', requireRole('developer'), async (req, res) => {
  const { email, displayName, password } = req.body;
  const fail = (error) => res.status(400).render('admin/admin_new', { title: 'Create admin', user: req.user, error, form: { email, displayName } });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
  if (!displayName?.trim()) return fail('Enter a display name.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) return fail('That email is already registered.');
  const hash = await hashPassword(password);
  const staffId = nextStaffId('admin');
  const info = db.prepare('INSERT INTO users (email, password_hash, display_name, role, staff_id, assigned_staff_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), hash, displayName.trim(), 'admin', staffId, req.user.staff_id);
  log('info', 'developer', 'admin created', { newAdminId: info.lastInsertRowid, staffId, developerId: req.user.id });
  res.redirect('/admin');
});

router.post('/admin/my-admins/:id/disable', requireRole('developer'), (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(target.id);
  log('info', 'developer', 'admin disabled', { targetId: target.id, developerId: req.user.id });
  res.redirect('/admin');
});
router.post('/admin/my-admins/:id/enable', requireRole('developer'), (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(target.id);
  log('info', 'developer', 'admin enabled', { targetId: target.id, developerId: req.user.id });
  res.redirect('/admin');
});
router.post('/admin/my-admins/:id/reset-password', requireRole('developer'), async (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  log('info', 'developer', 'staff reset admin password', { targetId: target.id, developerId: req.user.id });
  res.render('admin/dev_dashboard', { title: 'Developer dashboard', user: req.user, balance: getBalance(req.user.id), admins: myAdmins(req.user.staff_id), activeNav: 'admin', tempPassword, tempPasswordFor: target.display_name });
});

function renderAdminDetail(req, res, target, adjustError, status = 200, extra = {}) {
  res.status(status).render('admin/admin_detail', {
    title: `Admin: ${target.display_name}`, user: req.user, target,
    myBalance: getBalance(req.user.id), targetBalance: getBalance(target.id),
    entries: history(target.id, 200), adjustError, activeNav: 'admin',
    tempPassword: null, tempPasswordFor: null,
    ...extra,
  });
}

router.get('/admin/my-admins/:id', requireRole('developer'), (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  renderAdminDetail(req, res, target, null);
});

router.post('/admin/my-admins/:id/adjust', requireRole('developer'), (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  const amount = Math.round(Number(req.body.amount));
  const reason = (req.body.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) return renderAdminDetail(req, res, target, 'Enter a non-zero whole-credit amount.', 400);
  if (!reason) return renderAdminDetail(req, res, target, 'A reason is required.', 400);
  try {
    adminAdjust(target.id, amount, reason, req.user.id);
  } catch (e) {
    return renderAdminDetail(req, res, target, adjustErrorMessage(e, amount), 400);
  }
  res.redirect(`/admin/my-admins/${target.id}`);
});

router.post('/admin/my-admins/:id/reset-password-detail', requireRole('developer'), async (req, res) => {
  const target = loadMyAdmin(req, res);
  if (!target) return;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  log('info', 'developer', 'staff reset admin password', { targetId: target.id, developerId: req.user.id });
  renderAdminDetail(req, res, target, null, 200, { tempPassword, tempPasswordFor: target.display_name });
});

router.get('/admin/users', (req, res) => {
  const q = (req.query.q || '').trim();
  const scoped = isScoped(req);
  let rows;
  if (scoped && q) {
    rows = db.prepare("SELECT * FROM users WHERE role = 'user' AND assigned_staff_id = ? AND (email LIKE ? OR display_name LIKE ?) ORDER BY id DESC").all(req.user.staff_id, `%${q}%`, `%${q}%`);
  } else if (scoped) {
    rows = db.prepare("SELECT * FROM users WHERE role = 'user' AND assigned_staff_id = ? ORDER BY id DESC LIMIT 200").all(req.user.staff_id);
  } else if (q) {
    rows = db.prepare("SELECT * FROM users WHERE role = 'user' AND (email LIKE ? OR display_name LIKE ?) ORDER BY id DESC").all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare("SELECT * FROM users WHERE role = 'user' ORDER BY id DESC LIMIT 200").all();
  }
  const withBalance = rows.map((u) => ({ ...u, balance: getBalance(u.id) }));
  res.render('admin/users', { title: 'Users', user: req.user, users: withBalance, q, scoped, activeNav: 'admin' });
});

router.get('/admin/users/new', (req, res) => {
  res.render('admin/user_new', { title: 'Create user', user: req.user, error: null, form: {} });
});

router.post('/admin/users/new', async (req, res) => {
  const { email, displayName, password, address } = req.body;
  const fail = (error) => res.status(400).render('admin/user_new', { title: 'Create user', user: req.user, error, form: { email, displayName, address } });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
  if (!displayName?.trim()) return fail('Enter a display name.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) return fail('That email is already registered.');
  const hash = await hashPassword(password);
  // Whoever creates the account owns its support queue — the same rule that
  // applies to self-signups picking an Admin ID, just automatic here.
  const info = db.prepare('INSERT INTO users (email, password_hash, display_name, role, assigned_staff_id, address) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), hash, displayName.trim(), 'user', req.user.staff_id || null, (address || '').trim() || null);
  log('info', 'admin', 'user created by staff', { newUserId: info.lastInsertRowid, assignedTo: req.user.staff_id, adminId: req.user.id });
  res.redirect(`/admin/users/${info.lastInsertRowid}`);
});

function loadManagedUser(req, res) {
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(Number(req.params.id));
  if (!target) { res.status(404).render('error', { title: 'Not found', message: 'No such user account.', user: req.user }); return null; }
  if (isScoped(req) && target.assigned_staff_id !== req.user.staff_id) {
    res.status(403).render('error', { title: 'Not your player', message: `This player is assigned to ${target.assigned_staff_id || 'no one yet'}, not to you (${req.user.staff_id}). Ask a developer or owner for access, or have the player transfer to you.`, user: req.user });
    return null;
  }
  return target;
}

function renderUserDetail(req, res, target, adjustError, status = 200, extra = {}) {
  res.status(status).render('admin/user_detail', {
    title: `User: ${target.display_name}`, user: req.user, target,
    balance: getBalance(target.id), entries: history(target.id, 200), adjustError,
    staffList: activeStaff(), limits: getLimits(target.id), todayNetLoss: todayNetLoss(target.id),
    limitsError: null, limitsSaved: false,
    ...extra,
  });
}

router.get('/admin/users/:id', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  renderUserDetail(req, res, target, null);
});

router.post('/admin/users/:id/adjust', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  const amount = Math.round(Number(req.body.amount));
  const reason = (req.body.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) return renderUserDetail(req, res, target, 'Enter a non-zero whole-credit amount.', 400);
  if (!reason) return renderUserDetail(req, res, target, 'A reason is required for every manual adjustment.', 400);
  try {
    adminAdjust(target.id, amount, reason, req.user.id);
  } catch (e) {
    return renderUserDetail(req, res, target, adjustErrorMessage(e, amount), 400);
  }
  res.redirect(`/admin/users/${target.id}`);
});

router.post('/admin/users/:id/disable', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(target.id);
  log('info', 'admin', 'user disabled', { targetId: target.id, adminId: req.user.id });
  res.redirect(`/admin/users/${target.id}`);
});
router.post('/admin/users/:id/enable', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(target.id);
  log('info', 'admin', 'user enabled', { targetId: target.id, adminId: req.user.id });
  res.redirect(`/admin/users/${target.id}`);
});

// Reassigns a player's support queue to a different admin. A scoped admin
// can only transfer players who are currently theirs (enforced by
// loadManagedUser above); owner can transfer anyone. Developers aren't valid
// destinations — they don't manage users.
router.post('/admin/users/:id/transfer', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  const staffId = (req.body.staffId || '').trim().toUpperCase();
  const dest = db.prepare("SELECT staff_id, display_name FROM users WHERE staff_id = ? AND role = 'admin' AND disabled = 0").get(staffId);
  if (!dest) return renderUserDetail(req, res, target, `No active admin found with Staff ID "${staffId}".`, 400);
  db.prepare('UPDATE users SET assigned_staff_id = ? WHERE id = ?').run(dest.staff_id, target.id);
  log('info', 'admin', 'user transferred', { targetId: target.id, from: target.assigned_staff_id, to: dest.staff_id, adminId: req.user.id });
  res.redirect(`/admin/users/${target.id}`);
});

// Staff-assisted reset: if a player can't access the email their forgot-
// password code would go to, whoever manages them can hand them a fresh
// temporary password directly instead. Shown once, never emailed or logged.
router.post('/admin/users/:id/reset-password', async (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  log('info', 'admin', 'staff reset player password', { targetId: target.id, adminId: req.user.id });
  renderUserDetail(req, res, target, null, 200, { tempPassword, tempPasswordFor: target.display_name });
});

// Admin/developer/owner can set OR clear a player's responsible-play limits
// (unlike the player's own self-service version, staff can loosen or remove
// one — that's the point of having a support conversation about it first).
router.post('/admin/users/:id/limits', (req, res) => {
  const target = loadManagedUser(req, res);
  if (!target) return;
  const { pauseUntil, dailyLossLimit, clearPause, clearLossLimit } = req.body;
  let selfExcludeUntil = clearPause ? null : (pauseUntil ? new Date(pauseUntil).toISOString() : getLimits(target.id).self_exclude_until);
  if (pauseUntil && Number.isNaN(new Date(pauseUntil).getTime())) return renderUserDetail(req, res, target, null, 400, { limitsError: 'Enter a valid date.' });
  let dailyLossLimitVal = clearLossLimit ? null : (dailyLossLimit ? Math.round(Number(dailyLossLimit)) : getLimits(target.id).daily_loss_limit);
  if (dailyLossLimit && (!Number.isFinite(dailyLossLimitVal) || dailyLossLimitVal <= 0)) return renderUserDetail(req, res, target, null, 400, { limitsError: 'Enter a positive whole number.' });
  setLimits(target.id, { selfExcludeUntil, dailyLossLimit: dailyLossLimitVal }, req.user.id, req.user.role);
  log('info', 'admin', 'staff set player responsible-play limit', { targetId: target.id, selfExcludeUntil, dailyLossLimit: dailyLossLimitVal, adminId: req.user.id });
  res.redirect(`/admin/users/${target.id}`);
});

router.get('/admin/chat', (req, res) => {
  res.render('admin/chat', { title: 'Support chat', user: req.user, initialUserId: req.query.user ? Number(req.query.user) : null, activeNav: 'staffchat' });
});

router.get('/admin/analytics', (req, res) => {
  res.render('admin/analytics', { title: 'Analytics', user: req.user, analytics: analyticsSnapshot(), activeNav: 'admin' });
});
