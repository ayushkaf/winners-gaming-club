// server/routes/owner.js — Tier 1. Full config, validation reports, RTP/
// model-comparison figures, system logs, and admin/developer-account
// management. Engine math itself (core/, models/, the tuned coin weights) is
// never editable here — only presentational config (feature toggles, bet
// limits) and staff accounts are.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireRole, hashPassword, generateTempPassword } from '../auth.js';
import { db, log, allConfig, setConfig, nextStaffId } from '../db.js';
import { getModelSnapshot } from '../engineBridge.js';
import { verifyIntegrity, getBalance, history, adminAdjust, adjustErrorMessage } from '../ledger.js';
import { renderMarkdown } from '../markdown.js';

export const router = Router();
// Scoped to '/owner*' — every route in this file starts with that prefix.
// Without the path argument, router.use() runs for EVERY request reaching
// this router (mounted at the app root), silently gating any unrelated
// route mounted after it — this blocked developers/admins from /wallet
// (mounted after ownerRoutes) until scoped.
router.use('/owner', requireRole('owner'));

// this file lives at app/server/routes/owner.js — four levels below the repo
// root (routes -> server -> app -> Bullrush0).
const ROOT = path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
const REPORTS_DIR = path.join(ROOT, 'reports');

let validationSummary = null;
try { validationSummary = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'validation_summary.json'), 'utf8')); } catch { /* not generated yet */ }

router.get('/owner', (req, res) => {
  const counts = db.prepare("SELECT role, COUNT(*) AS n FROM users GROUP BY role").all();
  const errorCount = db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE level = 'error'").get().n;
  res.render('owner/dashboard', {
    title: 'Owner dashboard', user: req.user, counts, errorCount,
    snapshot: getModelSnapshot(), integrity: verifyIntegrity(), summary: validationSummary,
    activeNav: 'owner',
  });
});

router.get('/owner/config', (req, res) => {
  res.render('owner/config', { title: 'System configuration', user: req.user, config: allConfig(), snapshot: getModelSnapshot(), saved: req.query.saved === '1', activeNav: 'owner' });
});

router.post('/owner/config', (req, res) => {
  const editable = ['model_a_enabled', 'model_b_enabled', 'min_bet', 'max_bet'];
  for (const key of editable) {
    if (req.body[key] !== undefined) setConfig(key, req.body[key], req.user.id);
  }
  log('info', 'owner', 'config updated', { adminId: req.user.id, keys: Object.keys(req.body) });
  res.redirect('/owner/config?saved=1');
});

router.get('/owner/reports', (req, res) => {
  let files = [];
  try { files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md')); } catch { /* reports dir may not exist yet */ }
  res.render('owner/reports', { title: 'Validation reports', user: req.user, files, activeNav: 'owner' });
});

router.get('/owner/reports/:file', (req, res) => {
  const file = path.basename(req.params.file); // strip any path components — no traversal outside REPORTS_DIR
  const full = path.join(REPORTS_DIR, file);
  if (!full.startsWith(REPORTS_DIR) || !file.endsWith('.md') || !fs.existsSync(full)) {
    return res.status(404).render('error', { title: 'Not found', message: 'No such report.', user: req.user });
  }
  const html = renderMarkdown(fs.readFileSync(full, 'utf8'));
  res.render('owner/report_view', { title: file, user: req.user, file, html, activeNav: 'owner' });
});

router.get('/owner/logs', (req, res) => {
  const level = ['info', 'warn', 'error'].includes(req.query.level) ? req.query.level : null;
  const rows = level
    ? db.prepare('SELECT * FROM system_log WHERE level = ? ORDER BY id DESC LIMIT 300').all(level)
    : db.prepare('SELECT * FROM system_log ORDER BY id DESC LIMIT 300').all();
  res.render('owner/logs', { title: 'System logs', user: req.user, rows, level, activeNav: 'owner' });
});

function staffRows() {
  const rows = db.prepare("SELECT * FROM users WHERE role IN ('admin','developer','owner') ORDER BY (role = 'owner') DESC, (role = 'developer') DESC, id").all();
  return rows.map((r) => ({ ...r, balance: getBalance(r.id) }));
}

router.get('/owner/admins', (req, res) => {
  res.render('owner/admins', { title: 'Staff accounts', user: req.user, rows: staffRows(), activeNav: 'owner', tempPassword: null, tempPasswordFor: null });
});

router.post('/owner/admins/:id/reset-password', async (req, res) => {
  const target = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role IN ('admin','developer','owner')").get(Number(req.params.id));
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No such staff account.', user: req.user });
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  log('info', 'owner', 'staff reset staff password', { targetId: target.id, ownerId: req.user.id });
  res.render('owner/admins', { title: 'Staff accounts', user: req.user, rows: staffRows(), activeNav: 'owner', tempPassword, tempPasswordFor: target.display_name });
});

router.get('/owner/admins/new', (req, res) => {
  res.render('owner/admin_new', { title: 'Create staff account', user: req.user, error: null, form: {} });
});

router.post('/owner/admins/new', async (req, res) => {
  const { email, displayName, password, role, address } = req.body;
  const fail = (error) => res.status(400).render('owner/admin_new', { title: 'Create staff account', user: req.user, error, form: { email, displayName, role } });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
  if (!displayName?.trim()) return fail('Enter a display name.');
  if (!['admin', 'developer', 'owner'].includes(role)) return fail('Choose a permission level.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) return fail('That email is already registered.');
  const hash = await hashPassword(password);
  const staffId = nextStaffId(role);
  // Whoever creates an admin/developer is who they report to — the same
  // "reports to my creator" rule the whole staff hierarchy hangs off of
  // (see server/routes/chat.js's MANAGES map). Owners don't report to
  // anyone, so this is left null for role='owner'.
  const assignedTo = role === 'owner' ? null : req.user.staff_id;
  const info = db.prepare('INSERT INTO users (email, password_hash, display_name, role, staff_id, assigned_staff_id, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), hash, displayName.trim(), role, staffId, assignedTo, (address || '').trim() || null);
  log('info', 'owner', 'staff account created', { newUserId: info.lastInsertRowid, role, staffId, assignedTo, ownerId: req.user.id });
  res.redirect('/owner/admins');
});

// Owner reloads/takes out an admin's or developer's balance directly — the
// same tier-agnostic mechanic as everywhere else in the hierarchy. Owner
// accounts aren't valid targets (they only ever gain credits via mint).
// Registered AFTER the exact-path /owner/admins/new routes above — a ':id'
// route registered first would swallow "new" as if it were an id (the exact
// route-order bug this app has hit before: exact paths must come before
// param routes on the same prefix).
function loadStaffTarget(req, res) {
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('admin','developer')").get(Number(req.params.id));
  if (!target) { res.status(404).render('error', { title: 'Not found', message: 'No such staff account.', user: req.user }); return null; }
  return target;
}

function renderStaffDetail(req, res, target, adjustError, status = 200, extra = {}) {
  res.status(status).render('owner/staff_detail', {
    title: `Staff: ${target.display_name}`, user: req.user, target,
    myBalance: getBalance(req.user.id), targetBalance: getBalance(target.id),
    entries: history(target.id, 200), adjustError, activeNav: 'owner',
    tempPassword: null, tempPasswordFor: null,
    ...extra,
  });
}

router.get('/owner/admins/:id', (req, res) => {
  const target = loadStaffTarget(req, res);
  if (!target) return;
  renderStaffDetail(req, res, target, null);
});

router.post('/owner/admins/:id/adjust', (req, res) => {
  const target = loadStaffTarget(req, res);
  if (!target) return;
  const amount = Math.round(Number(req.body.amount));
  const reason = (req.body.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) return renderStaffDetail(req, res, target, 'Enter a non-zero whole-credit amount.', 400);
  if (!reason) return renderStaffDetail(req, res, target, 'A reason is required.', 400);
  try {
    adminAdjust(target.id, amount, reason, req.user.id);
  } catch (e) {
    return renderStaffDetail(req, res, target, adjustErrorMessage(e, amount), 400);
  }
  res.redirect(`/owner/admins/${target.id}`);
});

router.post('/owner/admins/:id/reset-password-detail', async (req, res) => {
  const target = loadStaffTarget(req, res);
  if (!target) return;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  log('info', 'owner', 'staff reset staff password', { targetId: target.id, ownerId: req.user.id });
  renderStaffDetail(req, res, target, null, 200, { tempPassword, tempPasswordFor: target.display_name });
});

// Fixes/sets who a staff account "reports to" (their assigned_staff_id) —
// mainly for accounts created before the staff hierarchy existed, which
// otherwise have nowhere to send their own /chat messages.
router.post('/owner/admins/:id/assign', (req, res) => {
  const target = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('admin','developer')").get(Number(req.params.id));
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No such staff account.', user: req.user });
  const wantRole = target.role === 'admin' ? 'developer' : 'owner';
  const staffId = String(req.body.staffId || '').trim().toUpperCase();
  const dest = db.prepare('SELECT staff_id FROM users WHERE staff_id = ? AND role = ? AND disabled = 0').get(staffId, wantRole);
  if (!dest) return res.status(400).render('error', { title: 'Invalid target', message: `No active ${wantRole} found with Staff ID "${staffId}".`, user: req.user });
  db.prepare('UPDATE users SET assigned_staff_id = ? WHERE id = ?').run(dest.staff_id, target.id);
  log('info', 'owner', 'staff manager reassigned', { targetId: target.id, to: dest.staff_id, ownerId: req.user.id });
  res.redirect('/owner/admins');
});

router.post('/owner/admins/:id/disable', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).render('error', { title: 'Not allowed', message: "You can't disable your own account.", user: req.user });
  db.prepare("UPDATE users SET disabled = 1 WHERE id = ? AND role IN ('admin','developer','owner')").run(id);
  log('info', 'owner', 'staff account disabled', { targetId: id, ownerId: req.user.id });
  res.redirect('/owner/admins');
});
router.post('/owner/admins/:id/enable', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE users SET disabled = 0 WHERE id = ? AND role IN ('admin','developer','owner')").run(id);
  log('info', 'owner', 'staff account enabled', { targetId: id, ownerId: req.user.id });
  res.redirect('/owner/admins');
});
router.post('/owner/admins/:id/role', (req, res) => {
  const id = Number(req.params.id);
  const role = req.body.role;
  if (!['admin', 'developer', 'owner'].includes(role)) return res.status(400).render('error', { title: 'Invalid role', message: 'Role must be admin, developer, or owner.', user: req.user });
  if (id === req.user.id && role !== 'owner') return res.status(400).render('error', { title: 'Not allowed', message: "You can't demote your own account.", user: req.user });
  const target = db.prepare("SELECT role, staff_id FROM users WHERE id = ? AND role IN ('admin','developer','owner')").get(id);
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No such staff account.', user: req.user });
  // Moving between admin<->developer changes the Staff ID prefix (ADMIN## vs
  // DEV##); a fresh ID is issued so it stays consistent with the new role.
  // Owner accounts don't carry a routing Staff ID.
  const staffId = role === 'owner' ? null : nextStaffId(role);
  db.prepare("UPDATE users SET role = ?, staff_id = ? WHERE id = ?").run(role, staffId, id);
  if (role !== 'owner') {
    // Anyone who was routed to the old staff_id follows to the new one so
    // their support queue doesn't silently orphan.
    db.prepare('UPDATE users SET assigned_staff_id = ? WHERE assigned_staff_id = ?').run(staffId, target.staff_id);
  }
  log('info', 'owner', 'staff role changed', { targetId: id, role, staffId, ownerId: req.user.id });
  res.redirect('/owner/admins');
});
