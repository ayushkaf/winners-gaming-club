// server/gateways.js — CRUD for the per-staff-member fake payment gateway
// config (server/db.js's payment_gateways table). Everything here is
// simulated: fake_credential is always an obviously-fake-formatted string
// (never a real merchant ID/API key/PayPal ID), and "processing" a payment
// (server/routes/payments.js) only ever moves Demo Credits through the
// existing ledger transfer mechanic — no card network, PayPal, Apple Pay, or
// Google Pay is ever contacted.
import { db } from './db.js';

export const METHODS = ['card', 'paypal', 'applepay', 'googlepay'];
export const METHOD_LABELS = { card: 'Visa / Mastercard', paypal: 'PayPal', applepay: 'Apple Pay', googlepay: 'Google Pay' };
export const FAKE_CREDENTIAL_PLACEHOLDER = {
  card: 'FAKE-MERCHANT-0000-0000',
  paypal: 'fake-merchant@example.invalid',
  applepay: 'FAKE-APPLEPAY-MERCHANT-000',
  googlepay: 'FAKE-GOOGLEPAY-MERCHANT-000',
};

// Always returns all 4 methods for a staff member, filling in an unset
// (never-configured) method with enabled:false defaults rather than omitting it.
export function getGateways(ownerUserId) {
  const rows = db.prepare('SELECT * FROM payment_gateways WHERE owner_user_id = ?').all(ownerUserId);
  const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]));
  return METHODS.map((m) => byMethod[m] || {
    owner_user_id: ownerUserId, method: m, enabled: 0, fake_credential: '', status_note: '', updated_at: null, updated_by: null,
  });
}

export function setGateway(ownerUserId, method, { enabled, fakeCredential, statusNote }, updatedBy) {
  if (!METHODS.includes(method)) throw new Error('unknown payment method');
  db.prepare(`
    INSERT INTO payment_gateways (owner_user_id, method, enabled, fake_credential, status_note, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, method) DO UPDATE SET
      enabled = excluded.enabled, fake_credential = excluded.fake_credential,
      status_note = excluded.status_note, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = excluded.updated_by
  `).run(ownerUserId, method, enabled ? 1 : 0, (fakeCredential || '').trim(), (statusNote || '').trim(), updatedBy);
}

// The methods a player sees on their "Add Demo Credits" page: only those
// enabled by the specific admin/developer they're assigned to.
export function enabledGatewaysForStaffId(staffId) {
  if (!staffId) return [];
  const staff = db.prepare("SELECT id FROM users WHERE staff_id = ? AND role IN ('admin','developer') AND disabled = 0").get(staffId);
  if (!staff) return [];
  return getGateways(staff.id).filter((g) => g.enabled);
}
