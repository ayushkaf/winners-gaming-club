// server/db.js — SQLite via Node's built-in driver (node:sqlite). No native
// deps, no build step. Schema enforces the ledger-integrity rules directly:
// balances are never stored as a mutable field, only ever summed from `ledger`.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.WGC_DB_PATH || path.join(DATA_DIR, 'winners.sqlite');

const USERS_TABLE_SQL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','admin','developer','owner')) DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  -- Staff ID (e.g. "ADMIN01", "DEV01"): the human-readable support-routing
  -- code assigned to admin/developer/owner accounts. NULL for role='user'.
  staff_id TEXT UNIQUE,
  -- For role='user' only: the staff_id of the admin/developer who owns this
  -- player's support queue. Set automatically when a staff member creates the
  -- account; for self-signups it's set once the player supplies a valid
  -- Admin ID (at signup or with their first support message).
  assigned_staff_id TEXT,
  -- Freeform, self-reported, NEVER verified — purely informational for staff.
  address TEXT,
  -- Responsible-play controls (server/limits.js). self_exclude_until: an ISO
  -- timestamp — play is blocked while it's in the future. daily_loss_limit:
  -- caps net credits a player can lose (stakes minus wins) in a rolling day.
  -- Either can be set by the player themselves (tightening only) or by their
  -- assigned admin (either direction) — never silently, always logged.
  self_exclude_until TEXT,
  daily_loss_limit INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`;

// Every balance change is one immutable row. Nothing ever UPDATEs or DELETEs a
// ledger row; a correction is a new offsetting row. resulting_balance is a
// convenience snapshot written atomically with the row, but it is NEVER the
// source of truth — GET /balance and every server-side check re-derive the
// balance as SUM(amount), and test_ledger_integrity.js asserts the two match.
//
// owner_mint / staff_transfer / fake_payment implement the credit supply
// chain: Owner mints from nothing into their own float; every other credit
// anyone holds arrived via a balance-checked transfer down the chain
// (Owner -> Developer/Admin/User, Developer -> Admin/User, Admin -> User).
// fake_payment is the same transfer mechanic, just tagged distinctly for a
// simulated payment-method purchase (server/routes/payments.js) — no real
// card, PayPal, Apple Pay, or Google Pay processing exists anywhere in this
// codebase; every "payment" only ever moves Demo Credits between ledger rows.
const LEDGER_TABLE_SQL = `
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('signup_bonus','topup_request','spin_stake','spin_win','admin_adjust','owner_mint','staff_transfer','fake_payment')),
  amount INTEGER NOT NULL,
  reason TEXT,
  admin_id INTEGER REFERENCES users(id),
  model TEXT CHECK (model IN ('A','B') OR model IS NULL),
  round_id TEXT,
  resulting_balance INTEGER NOT NULL
);`;

// Generic helper for the "SQLite can't ALTER a CHECK constraint, so rebuild
// the table" migration: rename, recreate from `createSql`, copy the given
// columns across, drop the renamed original. Run on a short-lived connection
// that's closed immediately after, so the long-lived `db` export below always
// opens onto an already-settled schema — node:sqlite's DDL change tracking
// within one open connection proved unreliable across a rename+recreate+drop
// of a table other tables reference (a later, unrelated prepare() would fail
// claiming the dropped intermediate table didn't exist).
function migrateTableIfNeeded(conn, tableName, createSql, copyColumns, markerText, needsFkToggle) {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  if (!row || row.sql.includes(markerText)) return false;
  if (needsFkToggle) conn.exec('PRAGMA foreign_keys = OFF');
  conn.exec('BEGIN IMMEDIATE');
  try {
    conn.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old_migrating`);
    conn.exec(createSql);
    conn.exec(`INSERT INTO ${tableName} (${copyColumns}) SELECT ${copyColumns} FROM ${tableName}_old_migrating`);
    conn.exec(`DROP TABLE ${tableName}_old_migrating`);
    conn.exec('COMMIT');
    console.log(`[db] migrated ${tableName} table (schema now includes "${markerText}")`);
  } catch (e) {
    conn.exec('ROLLBACK');
    throw e;
  } finally {
    if (needsFkToggle) conn.exec('PRAGMA foreign_keys = ON');
  }
  return true;
}

// ':memory:' is special-cased: node:sqlite gives each new DatabaseSync(':memory:')
// call its own independent database, so a throwaway migration connection
// would never share state with the real `db` export below — and since an
// in-memory database is always freshly created, there's never anything to
// migrate anyway.
const isMemoryDb = DB_PATH === ':memory:';
if (!isMemoryDb) {
  const mig = new DatabaseSync(DB_PATH);
  // `users` is referenced by other tables' FKs, so its rebuild needs FK
  // enforcement suspended for the duration; `ledger` isn't referenced by
  // anything, so its rebuild doesn't.
  migrateTableIfNeeded(mig, 'users', USERS_TABLE_SQL, 'id, email, password_hash, display_name, role, disabled, created_at', 'developer', true);
  migrateTableIfNeeded(mig, 'ledger', LEDGER_TABLE_SQL, 'id, ts, user_id, type, amount, reason, admin_id, model, round_id, resulting_balance', 'owner_mint', false);
  mig.exec(USERS_TABLE_SQL.replace('CREATE TABLE users', 'CREATE TABLE IF NOT EXISTS users'));
  mig.exec(LEDGER_TABLE_SQL.replace('CREATE TABLE ledger', 'CREATE TABLE IF NOT EXISTS ledger'));
  // chat_messages.image_path: a simple additive column, no CHECK constraint
  // involved, so a plain ALTER TABLE ADD COLUMN is enough (guarded so it only
  // runs once — SQLite errors if the column already exists).
  const chatCols = mig.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_messages'").get();
  if (chatCols && !chatCols.sql.includes('image_path')) {
    mig.exec('ALTER TABLE chat_messages ADD COLUMN image_path TEXT');
    console.log('[db] migrated chat_messages table to add image_path');
  }
  // Responsible-play controls (server/limits.js): self_exclude_until is an
  // ISO timestamp a player (or, more restrictively, an admin) has set to
  // pause their own play; daily_loss_limit caps net credits lost per day.
  // Both nullable, no CHECK constraint, so a plain ADD COLUMN suffices.
  const userCols = mig.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (userCols && !userCols.sql.includes('self_exclude_until')) {
    mig.exec('ALTER TABLE users ADD COLUMN self_exclude_until TEXT');
    mig.exec('ALTER TABLE users ADD COLUMN daily_loss_limit INTEGER');
    console.log('[db] migrated users table to add self_exclude_until, daily_loss_limit');
  }
  mig.close();
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
if (isMemoryDb) {
  db.exec(USERS_TABLE_SQL.replace('CREATE TABLE users', 'CREATE TABLE IF NOT EXISTS users'));
  db.exec(LEDGER_TABLE_SQL.replace('CREATE TABLE ledger', 'CREATE TABLE IF NOT EXISTS ledger'));
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  image_path TEXT,
  read_by_admin INTEGER NOT NULL DEFAULT 0,
  read_by_user INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, id);

-- Owner-editable feature toggles. Never touches engine math (core/models are
-- unmodified); this only gates whether a model is offered for play right now.
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS system_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON system_log(id DESC);

-- Forgot-password one-time codes. code_hash is a SHA-256 hex digest, never
-- the raw code — same "never store the secret in plaintext" rule as
-- password_hash, just a lighter hash since these expire in minutes and are
-- single-use rather than long-lived credentials.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_user ON password_resets(user_id, id);

-- One row per (staff member, payment method). Everything here is fake by
-- design: fake_credential holds an obviously-fake-formatted merchant
-- ID/API key/PayPal ID string, never a real one, and enabled/status_note let
-- an admin mark a method unavailable without deleting its configuration.
-- A player only ever sees the methods their assigned admin has enabled here.
CREATE TABLE IF NOT EXISTS payment_gateways (
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL CHECK (method IN ('card','paypal','applepay','googlepay')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fake_credential TEXT,
  status_note TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (owner_user_id, method)
);
`);

const defaults = {
  model_a_enabled: 'true',
  model_b_enabled: 'true',
  target_rtp_a: '0.9609',
  target_rtp_b: '0.9610',
  min_bet: '1',
  max_bet: '300',
};
const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertConfig.run(k, v);

// Drop config keys from earlier iterations that no longer apply.
db.prepare("DELETE FROM config WHERE key IN ('max_bet_multiplier', 'signup_bonus_multiplier')").run();

export function log(level, source, message, meta) {
  db.prepare('INSERT INTO system_log (level, source, message, meta) VALUES (?, ?, ?, ?)')
    .run(level, source, message, meta ? JSON.stringify(meta) : null);
  if (level === 'error') console.error(`[${source}] ${message}`, meta || '');
}

export function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : undefined;
}
export function setConfig(key, value, adminId) {
  db.prepare(`INSERT INTO config (key, value, updated_by) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = excluded.updated_by`)
    .run(key, String(value), adminId);
}
export function allConfig() {
  return db.prepare('SELECT key, value, updated_at, updated_by FROM config ORDER BY key').all();
}

// Generates the next sequential Staff ID for a role, e.g. ADMIN01, ADMIN02,
// ... / DEV01, DEV02, .... Prefix is derived from the role.
const STAFF_PREFIX = { admin: 'ADMIN', developer: 'DEV', owner: 'OWNER' };
export function nextStaffId(role) {
  const prefix = STAFF_PREFIX[role];
  if (!prefix) return null;
  const rows = db.prepare('SELECT staff_id FROM users WHERE staff_id LIKE ?').all(prefix + '%');
  let max = 0;
  for (const r of rows) {
    const m = r.staff_id.match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(2, '0');
}

// Every owner needs a Staff ID too, not just admin/developer — the staff
// support hierarchy (admin -> the developer who created them -> the owner
// who created that developer) needs a routing target at the very top, and
// the seed script never assigned one. Self-heals any owner row missing it.
// Must run after nextStaffId/STAFF_PREFIX are defined above.
for (const row of db.prepare("SELECT id FROM users WHERE role = 'owner' AND staff_id IS NULL").all()) {
  db.prepare('UPDATE users SET staff_id = ? WHERE id = ?').run(nextStaffId('owner'), row.id);
}
