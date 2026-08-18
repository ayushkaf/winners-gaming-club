// server/auth.js — password hashing, JWT session cookies, role guards.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db, log } from './db.js';

// Refuse to run in production on the development fallback below.
//
// This file is published in a public repository, so that string is public
// knowledge. A deployment that never set WGC_JWT_SECRET would be signing its
// session cookies with a value anyone can read, and minting an owner-role
// token would be a one-liner. No length or format check can catch this — only
// an explicit refusal can, so the failure happens at boot rather than silently
// at every login.
if (process.env.NODE_ENV === 'production' && !process.env.WGC_JWT_SECRET) {
  throw new Error(
    'Refusing to start in production without WGC_JWT_SECRET. The fallback in ' +
      'server/auth.js ships publicly and is therefore not a secret. Set ' +
      'WGC_JWT_SECRET to a long random value (48 bytes or more) before deploying.',
  );
}

const JWT_SECRET = process.env.WGC_JWT_SECRET || 'dev-only-secret-change-in-production-2026';
const COOKIE_NAME = 'wgc_session';
const TOKEN_TTL = '12h';

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}
// For staff-assisted resets: "if they can't access their email, whoever
// manages them can reset it instead." Shown once to the acting staff member
// to hand off out-of-band — never emailed, never logged in plaintext.
export function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, url-safe
}
export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}
export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

const getUserById = db.prepare('SELECT id, email, display_name, role, disabled, staff_id, assigned_staff_id, address, created_at FROM users WHERE id = ?');

// Verifies a raw session-cookie token string (used by the WebSocket upgrade
// handler, which sits outside Express middleware and has no req.cookies).
export function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById.get(payload.uid);
    return user && !user.disabled ? user : null;
  } catch {
    return null;
  }
}
export const SESSION_COOKIE_NAME = COOKIE_NAME;

// Populates req.user (or null) from the session cookie on every request.
export function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById.get(payload.uid);
    if (user && !user.disabled) req.user = user;
    else if (user && user.disabled) clearSession(res);
  } catch {
    clearSession(res);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'not authenticated' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      log('warn', 'auth', 'role check failed', { path: req.path, role: req.user?.role, needed: roles });
      if (req.accepts('html')) return res.status(403).render('error', { title: 'Forbidden', message: "You don't have permission to view this page.", user: req.user });
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
