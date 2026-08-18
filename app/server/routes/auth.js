// server/routes/auth.js — signup (with the fixed 20-credit signup bonus),
// login, logout, and forgot/reset password. No real payment fields exist
// anywhere in this flow.
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, log } from '../db.js';
import { hashPassword, verifyPassword, issueSession, clearSession } from '../auth.js';
import { creditFixedSignupBonus, SIGNUP_BONUS_CREDITS } from '../ledger.js';
import { sendEmail } from '../mailer.js';
import { emailPseudonym } from '../pii.js';

export const router = Router();

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
const RESET_CODE_TTL_MIN = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/play');
  res.render('signup', { title: 'Join Winners Gaming Club', user: null, error: null, form: {} });
});

router.post('/signup', async (req, res) => {
  const { email, password, displayName, address, staffId } = req.body;
  const form = { email, displayName, address, staffId };
  const fail = (error) => res.status(400).render('signup', { title: 'Join Winners Gaming Club', user: null, error, form });

  if (!email || !EMAIL_RE.test(email)) return fail('Enter a valid email address.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
  if (!displayName || !displayName.trim()) return fail('Enter a display name.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return fail('An account with that email already exists.');

  // Optional: quoting a real staff member's Admin ID at signup pre-routes the
  // player's support queue. An unrecognized ID is just ignored, not a hard
  // failure — the player can still supply one later from the chat page.
  let assignedStaffId = null;
  const wantedStaffId = (staffId || '').trim().toUpperCase();
  if (wantedStaffId) {
    const dest = db.prepare("SELECT staff_id FROM users WHERE staff_id = ? AND role IN ('admin','developer') AND disabled = 0").get(wantedStaffId);
    if (dest) assignedStaffId = dest.staff_id;
  }

  const passwordHash = await hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, display_name, role, assigned_staff_id, address) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email.toLowerCase(), passwordHash, displayName.trim(), 'user', assignedStaffId, (address || '').trim() || null);
  const userId = Number(info.lastInsertRowid);

  creditFixedSignupBonus(userId);

  // userId is the identifier an operator actually needs — it joins to the
  // account record, the ledger and the chat threads. The address itself would
  // only be a copy of data the users table already holds, sitting in a log
  // that gets rendered verbatim at /owner/logs; emailPseudonym keeps the one
  // property the log needs from it, which is matching this signup against
  // earlier failed-login probes from the same address. See server/pii.js.
  log('info', 'auth', 'user signed up', { userId, emailHash: emailPseudonym(email), assignedStaffId, bonus: SIGNUP_BONUS_CREDITS });
  const user = db.prepare('SELECT id, email, display_name, role, disabled, staff_id, assigned_staff_id, address, created_at FROM users WHERE id = ?').get(userId);
  issueSession(res, user);
  res.redirect('/play?welcome=1');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/play');
  res.render('login', { title: 'Log in', user: null, error: null, email: '', reset: req.query.reset === '1' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !(await verifyPassword(password || '', user.password_hash))) {
    // The one log line that used to collect addresses belonging to people who
    // may have no account here at all — anyone who mistyped, or who was
    // guessed at by someone probing the form. What an operator investigating
    // abuse needs is "how many attempts, against whom, from where in the
    // sequence", and both halves of that survive redaction: userId names the
    // target outright whenever the address does resolve to a real account,
    // and emailHash still groups repeated attempts against the same unknown
    // address together without recording the address. See server/pii.js.
    log('warn', 'auth', 'failed login attempt', { userId: user ? user.id : null, emailHash: emailPseudonym(email) });
    return res.status(401).render('login', { title: 'Log in', user: null, error: 'Incorrect email or password.', email });
  }
  if (user.disabled) {
    return res.status(403).render('login', { title: 'Log in', user: null, error: 'This account has been disabled. Contact support.', email });
  }
  issueSession(res, user);
  log('info', 'auth', 'user logged in', { userId: user.id });
  if (user.role === 'owner') return res.redirect('/owner');
  if (user.role === 'admin' || user.role === 'developer') return res.redirect('/admin');
  res.redirect('/play');
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.redirect('/');
});

// ---------------------------------------------------------------- forgot / reset password
router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { title: 'Forgot password', user: null, sent: false, error: null });
});

router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const target = db.prepare('SELECT id, display_name FROM users WHERE email = ? AND disabled = 0').get(email);
  // Always show the same success message whether or not the email is
  // registered — otherwise this endpoint becomes an account-existence
  // oracle for anyone probing it.
  if (target) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MIN * 60000).toISOString();
    db.prepare('INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)').run(target.id, hashCode(code), expiresAt);
    await sendEmail(email, 'Winners Gaming Club — password reset code',
      `Hi ${target.display_name},\n\nYour password reset code is ${code}. It expires in ${RESET_CODE_TTL_MIN} minutes.\n\nIf you didn't request this, you can ignore it — your password hasn't changed.`);
    log('info', 'auth', 'password reset code issued', { userId: target.id });
  }
  res.render('forgot_password', { title: 'Forgot password', user: null, sent: true, error: null, email });
});

router.get('/reset-password', (req, res) => {
  res.render('reset_password', { title: 'Reset password', user: null, error: null, email: req.query.email || '' });
});

router.post('/reset-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  const password = req.body.password || '';
  const fail = (error) => res.status(400).render('reset_password', { title: 'Reset password', user: null, error, email });

  if (!password || password.length < 8) return fail('New password must be at least 8 characters.');
  const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!target) return fail('Invalid or expired code.');
  const row = db.prepare(`
    SELECT id FROM password_resets
    WHERE user_id = ? AND code_hash = ? AND used = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY id DESC LIMIT 1
  `).get(target.id, hashCode(code));
  if (!row) return fail('Invalid or expired code.');

  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  log('info', 'auth', 'password reset via emailed code', { userId: target.id });
  res.redirect('/login?reset=1');
});
