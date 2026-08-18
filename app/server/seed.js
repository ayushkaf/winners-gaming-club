// server/seed.js — creates the first owner account so there's a way into
// Tier 1 on a fresh database. Safe to re-run: no-ops if an owner already
// exists. Usage: npm run seed (reads WGC_OWNER_EMAIL / WGC_OWNER_PASSWORD
// from env, or falls back to the printed defaults below — change the
// password immediately in a shared environment).
import { db, log } from './db.js';
import { hashPassword } from './auth.js';
import { emailPseudonym } from './pii.js';

const email = (process.env.WGC_OWNER_EMAIL || 'owner@winners.demo').toLowerCase();
const password = process.env.WGC_OWNER_PASSWORD || 'ChangeMe123!';
const displayName = process.env.WGC_OWNER_NAME || 'Platform Owner';

const existingOwner = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();
if (existingOwner) {
  console.log('An owner account already exists (id', existingOwner.id, '). Nothing to do.');
  process.exit(0);
}

const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existingEmail) {
  db.prepare("UPDATE users SET role = 'owner', disabled = 0 WHERE id = ?").run(existingEmail.id);
  console.log(`Promoted existing account ${email} to owner.`);
  process.exit(0);
}

const hash = await hashPassword(password);
const info = db.prepare('INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(email, hash, displayName, 'owner');
// Pseudonymised for the same reason as every other address in system_log:
// the table is rendered verbatim to owner-tier accounts at /owner/logs.
log('info', 'seed', 'owner account created', { id: info.lastInsertRowid, emailHash: emailPseudonym(email) });
console.log('Owner account created:');
console.log('  email   :', email);
console.log('  password:', password);
console.log('Log in at /login, then visit /owner. Change this password by creating a fresh account and disabling this one, or wire up a password-change route before sharing this instance.');
