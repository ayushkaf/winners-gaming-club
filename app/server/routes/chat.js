// server/routes/chat.js — REST endpoints for chat history; live delivery is
// handled by server/ws.js. REST is also the fallback path so the thread still
// works (with a manual refresh) if a websocket connection can't be made.
//
// Route order matters here: '/api/chat' (bare, staff inbox) is registered
// before '/api/chat/:userId' so it isn't shadowed by the parameterized route.
//
// The support hierarchy is generic and reused at every tier: a manager's
// inbox always lists threads for the accounts assigned to their own Staff
// ID, one tier down — admin manages users, developer manages admins, owner
// manages developers. MANAGES maps a role to the role one tier below it.
// Every account also has its OWN outbound thread (server/routes/user.js's
// /chat, keyed by their own account id) to whoever manages THEM — a user
// talks to their admin, an admin talks to their developer, a developer
// talks to their owner. Same chat_messages table and sender_role values
// throughout: sender_role='user' always means "the thread owner side" and
// 'admin' always means "the manager/responder side," regardless of the
// real role on either end — no schema change needed to support this.
//
// Image attachments are private files, not public ones. They are stored
// OUTSIDE public/ and handed out only by attachmentRouter (below), which
// re-runs the very same thread-scope check as the message-history endpoint —
// so an attachment is never readable by anyone who couldn't read the message
// it was posted in. server/index.js mounts that router ahead of the static
// middleware precisely so the check cannot be routed around.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { requireAuth, requireRole } from '../auth.js';
import { db, log } from '../db.js';

export const router = Router();

const MANAGES = { admin: 'user', developer: 'admin', owner: 'developer' };

// this file lives at app/server/routes/chat.js — two levels below app/.
const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
// Attachments live in the runtime data directory, NOT under public/. Anything
// under public/ is served by the express.static mount in server/index.js to
// whoever asks, with no session check whatsoever — which made every support
// screenshot fetchable by an unauthenticated stranger, guarded by nothing but
// the unguessability of a UUID that the app itself hands out in JSON and
// renders as a plain link. app/data/ is already gitignored, so uploads stay
// out of the published repository as a side effect of living here.
const UPLOAD_DIR = path.join(APP_ROOT, 'data', 'uploads', 'chat');
// Attachments written before that move. They are live user data, so they are
// left exactly where they are rather than relocated under a running
// operator's feet; the serving route below falls back to this directory so
// existing messages keep rendering. Because attachmentRouter is mounted AHEAD
// of express.static, those older files are now behind the same authentication
// as everything else despite still sitting inside public/.
const LEGACY_UPLOAD_DIR = path.join(APP_ROOT, 'public', 'uploads', 'chat');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

// The URL shape is deliberately unchanged by the move. It is what
// server/ws.js validates before accepting a send, what is already stored in
// chat_messages.image_path on every message ever sent, and what
// public/js/chat.js renders — only what sits behind the URL changed, from a
// directory listing to an authenticated route.
const ATTACHMENT_URL_PREFIX = '/uploads/chat/';
const ATTACHMENT_FILENAME_RE = /^[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/i;

// The single definition of "may this account read this thread". Your own
// thread is always yours; anyone else's is readable only by the manager one
// tier above them (MANAGES) that the account is actually assigned to. Shared
// by the history endpoint and the attachment route so the two can never drift
// apart into a permission gap.
function canReadThread(user, threadUserId) {
  if (threadUserId === user.id) return true;
  const manages = MANAGES[user.role];
  if (!manages) return false;
  const target = db.prepare('SELECT role, assigned_staff_id FROM users WHERE id = ?').get(threadUserId);
  return !!target && target.role === manages && target.assigned_staff_id === user.staff_id;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Random filename — never trusts the client-supplied name, so there's no
    // path-traversal or overwrite risk from what the browser sends.
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, file.mimetype)),
});

// A freshly staged upload has no chat_messages row yet — the upload endpoint
// only puts the file on disk and hands back its URL; the row appears later,
// when the client quotes that URL in its next websocket 'send'. The composer
// shows a preview the moment the upload finishes, so during that window the
// file has to be fetchable by the one account that uploaded it and by nobody
// else. This map is that window: it is the only authorization fact that
// exists before the message row does.
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000; // far longer than composing a message takes
const pendingUploads = new Map(); // filename -> { userId, expiresAt }

function rememberPendingUpload(filename, userId) {
  const now = Date.now();
  // Swept opportunistically on write rather than on a timer — the map only
  // ever holds the handful of uploads staged in the last hour, and a stale
  // entry grants nothing to anyone but its own uploader anyway.
  for (const [name, entry] of pendingUploads) if (entry.expiresAt <= now) pendingUploads.delete(name);
  pendingUploads.set(filename, { userId, expiresAt: now + PENDING_UPLOAD_TTL_MS });
}
function isOwnPendingUpload(filename, userId) {
  const entry = pendingUploads.get(filename);
  return !!entry && entry.expiresAt > Date.now() && entry.userId === userId;
}

// Screenshot/photo attachments for support chat. Returns a path the client
// then includes in its next websocket 'send' — the upload itself doesn't
// post a message, it just stages the file.
router.post('/api/chat/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (5MB max).' : 'Could not upload that file.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Only PNG, JPEG, GIF, or WebP images are allowed.' });
    rememberPendingUpload(req.file.filename, req.user.id);
    log('info', 'chat', 'image uploaded', { userId: req.user.id, file: req.file.filename, size: req.file.size });
    res.json({ path: ATTACHMENT_URL_PREFIX + req.file.filename });
  });
});

// ---------------------------------------------------------------- attachment delivery
// Mounted separately in server/index.js, BEFORE express.static, so that
// neither a file left behind under public/uploads/ nor any future one can be
// served without passing the check below first. Kept on the historical
// /uploads/chat/... URL rather than moved to a new /api/... one because that
// exact string is already stored in chat_messages.image_path on every
// message ever sent and is validated character-for-character by
// server/ws.js — changing it would break every existing attachment and take
// a database rewrite to repair.
export const attachmentRouter = Router();

const findAttachmentThread = db.prepare('SELECT user_id FROM chat_messages WHERE image_path = ? ORDER BY id ASC LIMIT 1');

attachmentRouter.get('/uploads/chat/:file', requireAuth, (req, res) => {
  const file = req.params.file;
  // Only ever a filename this server minted itself. This doubles as the
  // traversal guard: a UUID plus a known extension cannot contain a slash or
  // a dot-segment, encoded or otherwise.
  if (!ATTACHMENT_FILENAME_RE.test(file)) return res.status(404).json({ error: 'not found' });

  const row = findAttachmentThread.get(ATTACHMENT_URL_PREFIX + file);
  // A file with no message row is either still staged in someone's composer
  // or was uploaded and never sent — either way it belongs to its uploader
  // alone until a message makes it part of a thread.
  const allowed = row ? canReadThread(req.user, row.user_id) : isOwnPendingUpload(file, req.user.id);
  if (!allowed) {
    // The filename is a random UUID, not personal data — safe to log, and an
    // operator chasing someone trawling for attachments needs it.
    log('warn', 'chat', 'attachment access denied', { userId: req.user.id, file });
    return res.status(403).json({ error: 'That attachment is not part of a conversation you can see.' });
  }

  // Current location first, then the pre-move one. `root` confines sendFile
  // to that single directory even if the filename check above were ever
  // loosened, and the cache headers keep a private image out of any shared
  // proxy cache between here and the browser.
  const root = fs.existsSync(path.join(UPLOAD_DIR, file)) ? UPLOAD_DIR : LEGACY_UPLOAD_DIR;
  res.sendFile(file, {
    root,
    dotfiles: 'deny',
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }, (err) => {
    // Missing file, or the client hung up mid-transfer. Nothing useful to say
    // if the response has already started.
    if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
  });
});

// Belt and braces: /uploads/ holds nothing else that is servable. Every other
// path in that namespace dead-ends here rather than falling through to the
// static mount registered behind this router.
attachmentRouter.use('/uploads', (req, res) => res.status(404).json({ error: 'not found' }));

// A self-signed-up player routes their support queue by quoting a staff
// member's Admin ID (e.g. "ADMIN01"). Idempotent-ish: calling it again with a
// different valid ID re-routes the player, same as the transfer feature does
// from the staff side.
router.post('/api/chat/assign', requireRole('user'), (req, res) => {
  const staffId = String(req.body.staffId || '').trim().toUpperCase();
  if (!staffId) return res.status(400).json({ error: 'Enter an Admin ID.' });
  // Admins only — developers don't manage users, so they're never a valid
  // self-routing destination.
  const dest = db.prepare("SELECT staff_id, display_name FROM users WHERE staff_id = ? AND role = 'admin' AND disabled = 0").get(staffId);
  if (!dest) return res.status(404).json({ error: `No active admin found with ID "${staffId}". Double-check it and try again.` });
  db.prepare('UPDATE users SET assigned_staff_id = ? WHERE id = ?').run(dest.staff_id, req.user.id);
  log('info', 'chat', 'player self-assigned to staff', { userId: req.user.id, staffId: dest.staff_id });
  res.json({ ok: true, staffId: dest.staff_id, staffName: dest.display_name });
});

// A manager's inbox: every account one tier below them (MANAGES[role]) whose
// assigned_staff_id is their own Staff ID. Same shape at every tier — admin
// sees their users, developer sees their admins, owner sees their developers.
router.get('/api/chat', requireRole('admin', 'developer', 'owner'), (req, res) => {
  const manages = MANAGES[req.user.role];
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.email, u.display_name,
           MAX(c.ts) AS last_ts,
           SUM(CASE WHEN c.sender_role = 'user' AND c.read_by_admin = 0 THEN 1 ELSE 0 END) AS unread
    FROM chat_messages c JOIN users u ON u.id = c.user_id
    WHERE u.role = ? AND u.assigned_staff_id = ?
    GROUP BY u.id ORDER BY last_ts DESC
  `).all(manages, req.user.staff_id);
  res.json({ threads: rows });
});

router.get('/api/chat/:userId?', requireAuth, (req, res) => {
  // Bare /api/chat/ (no id) with no staff-inbox context means "my own
  // outbound thread" — used by /chat for any role (user, admin, developer).
  let userId = req.user.id;
  if (req.params.userId) {
    userId = Number(req.params.userId);
    // Viewing someone ELSE's thread — only valid for a manager looking at
    // an account one tier below them that's actually assigned to them.
    if (!canReadThread(req.user, userId)) {
      return res.status(403).json({ error: 'That account is not assigned to you.' });
    }
  }
  const rows = db.prepare(`
    SELECT c.*, u.display_name AS sender_display_name, u.staff_id AS sender_staff_id
    FROM chat_messages c JOIN users u ON u.id = c.sender_id
    WHERE c.user_id = ? ORDER BY c.id ASC
  `).all(userId);
  if (userId === req.user.id) {
    db.prepare("UPDATE chat_messages SET read_by_user = 1 WHERE user_id = ? AND sender_role = 'admin'").run(userId);
  } else {
    db.prepare("UPDATE chat_messages SET read_by_admin = 1 WHERE user_id = ? AND sender_role = 'user'").run(userId);
  }
  res.json({ messages: rows });
});
