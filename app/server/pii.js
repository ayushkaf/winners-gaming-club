// server/pii.js — one-way pseudonyms for the few values that have to be
// correlated in the system log but must never be stored there in the clear.
//
// `system_log` is not a transient stream: every row is persisted in the
// database and rendered verbatim to owner-tier accounts at /owner/logs. So
// anything written into it is personal data at rest with a human audience.
// Email addresses used to go in directly — including on FAILED logins, which
// meant the table steadily accumulated the addresses of people who may not
// even have an account here, harvested from nothing more than a typo or a
// stranger probing the login form.
//
// The operational question an operator actually asks of those rows is only
// ever "is this the same address as that one?" — thirty failed attempts
// against a single target, or a signup matching an earlier probe. A keyed
// digest answers that exactly as well as the raw address does, and answers
// nothing else.
//
// HMAC rather than a bare SHA-256, because the space of real email addresses
// is small and guessable: a plain hash can be confirmed against a hunch ("is
// this person in here?") by anyone who obtains the log, which would put the
// addresses straight back at rest in everything but name. Without the key an
// HMAC digest can't be tested against a guess.
import crypto from 'node:crypto';

// The pepper must be STABLE across restarts — if it changes, digests stop
// matching their own history and the correlation the log exists for is lost —
// and it must be SECRET, or the HMAC degrades to the plain hash described
// above. Set WGC_LOG_PEPPER in production. It falls back to the session
// signing secret so a fresh clone runs with no configuration at all, and
// finally to a development default. It is never logged or rendered anywhere.
const PEPPER = process.env.WGC_LOG_PEPPER
  || process.env.WGC_JWT_SECRET
  || 'dev-only-log-pepper-change-in-production-2026';

// 16 hex characters (64 bits) of HMAC-SHA256 over the trimmed, lowercased
// address: short enough to eyeball and match by sight in the log viewer, wide
// enough that two different addresses colliding is not a practical concern.
// Normalizing first means "Bob@Example.com " and "bob@example.com" correlate,
// which is what an operator chasing repeated attempts wants.
export function emailPseudonym(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHmac('sha256', PEPPER).update(normalized).digest('hex').slice(0, 16);
}
