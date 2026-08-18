// server/routes/payments.js — the demo credit supply chain and the fake
// payment gateway simulation. Nothing here processes a real card, PayPal,
// Apple Pay, or Google Pay transaction — every "payment" is a balance-checked
// transfer between ledger rows (server/ledger.js), and every stored
// credential is an obviously-fake placeholder string (server/gateways.js).
//
// Chain: Owner mints from nothing -> transfers to Developer/Admin/User float
// -> Developer transfers to Admin/User -> Admin transfers to User. A player's
// "Add Demo Credits" purchase is the same transfer mechanic, sourced from
// their assigned admin's float and gated by that admin's own gateway
// enabled/disabled toggles.
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { db, log } from '../db.js';
import { getBalance, history, ownerMint, transferCredits, InsufficientBalanceError } from '../ledger.js';
import { getGateways, setGateway, enabledGatewaysForStaffId, METHODS, METHOD_LABELS, FAKE_CREDENTIAL_PLACEHOLDER } from '../gateways.js';

export const router = Router();

// ---------------------------------------------------------------- wallet (owner/developer/admin)
router.get('/wallet', requireRole('owner', 'developer', 'admin'), (req, res) => {
  res.render('wallet', {
    title: 'My wallet', user: req.user, balance: getBalance(req.user.id),
    entries: history(req.user.id, 100).filter((e) => ['owner_mint', 'staff_transfer', 'fake_payment', 'admin_adjust'].includes(e.type)),
    mintError: null, transferError: null, transferOk: null, activeNav: 'wallet',
  });
});

router.post('/wallet/mint', requireRole('owner'), (req, res) => {
  const amount = Math.round(Number(req.body.amount));
  const note = (req.body.note || '').trim();
  const render = (mintError) => res.status(400).render('wallet', {
    title: 'My wallet', user: req.user, balance: getBalance(req.user.id),
    entries: history(req.user.id, 100).filter((e) => ['owner_mint', 'staff_transfer', 'fake_payment', 'admin_adjust'].includes(e.type)),
    mintError, transferError: null, transferOk: null, activeNav: 'wallet',
  });
  if (!Number.isFinite(amount) || amount <= 0) return render('Enter a positive whole-credit amount to mint.');
  ownerMint(req.user.id, amount, note || 'Owner mint', req.user.id);
  log('info', 'payments', 'owner minted', { ownerId: req.user.id, amount });
  res.redirect('/wallet');
});

function scopeAllowsTransfer(actorRole, actorStaffId, target) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'developer') return target.role === 'admin' || target.role === 'user';
  if (actorRole === 'admin') return target.role === 'user' && target.assigned_staff_id === actorStaffId;
  return false;
}

router.post('/wallet/transfer', requireRole('owner', 'developer', 'admin'), (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const amount = Math.round(Number(req.body.amount));
  const note = (req.body.note || '').trim();
  const renderErr = (transferError) => res.status(400).render('wallet', {
    title: 'My wallet', user: req.user, balance: getBalance(req.user.id),
    entries: history(req.user.id, 100).filter((e) => ['owner_mint', 'staff_transfer', 'fake_payment', 'admin_adjust'].includes(e.type)),
    mintError: null, transferError, transferOk: null, activeNav: 'wallet',
  });
  if (!email) return renderErr('Enter the recipient\'s email.');
  if (!Number.isFinite(amount) || amount <= 0) return renderErr('Enter a positive whole-credit amount.');
  const target = db.prepare('SELECT id, role, assigned_staff_id, disabled FROM users WHERE email = ?').get(email);
  if (!target || target.disabled) return renderErr('No active account found with that email.');
  if (target.id === req.user.id) return renderErr('You cannot transfer to yourself.');
  if (!scopeAllowsTransfer(req.user.role, req.user.staff_id, target)) {
    return renderErr(req.user.role === 'admin' ? 'You can only send credits to your own assigned players.' : 'You cannot send credits to that account.');
  }
  try {
    transferCredits(req.user.id, target.id, amount, note || 'Wallet transfer', req.user.id);
  } catch (e) {
    if (e instanceof InsufficientBalanceError) return renderErr(`Your float only has ${e.have.toLocaleString()} credits — not enough for this transfer.`);
    throw e;
  }
  // Both ends recorded by account id, not by address. The recipient was
  // looked up by email a few lines above, so target.id is the same account
  // the transfer actually credited — a strictly better audit key than the
  // typed-in string, and it keeps a copy of the recipient's address out of
  // system_log, which is persisted and rendered verbatim at /owner/logs. The
  // matching ledger rows carry the amounts and the reversibility story.
  log('info', 'payments', 'wallet transfer', { fromId: req.user.id, toId: target.id, amount });
  res.redirect('/wallet');
});

// ---------------------------------------------------------------- payment gateway config (admin/developer own; owner any)
function resolveGatewayTarget(req) {
  if (req.user.role === 'owner' && req.query.staffId) {
    const t = db.prepare("SELECT id, staff_id, display_name, role FROM users WHERE staff_id = ?").get(String(req.query.staffId).toUpperCase());
    return t || null;
  }
  return { id: req.user.id, staff_id: req.user.staff_id, display_name: req.user.display_name, role: req.user.role };
}

router.get('/gateway', requireRole('owner', 'developer', 'admin'), (req, res) => {
  const target = resolveGatewayTarget(req);
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No staff account with that Staff ID.', user: req.user });
  res.render('gateway', {
    title: 'Payment gateway', user: req.user, target, editingSelf: target.id === req.user.id,
    gateways: getGateways(target.id), methods: METHODS, labels: METHOD_LABELS, placeholders: FAKE_CREDENTIAL_PLACEHOLDER,
    saved: req.query.saved === '1', activeNav: 'gateway',
  });
});

router.post('/gateway', requireRole('owner', 'developer', 'admin'), (req, res) => {
  const target = resolveGatewayTarget(req);
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No staff account with that Staff ID.', user: req.user });
  // Safety rule: a developer may view everyone's players/chat, but may NEVER
  // edit an admin's own gateway config — only that admin themselves, or the
  // owner, can. (Editing your own is always fine.)
  if (target.id !== req.user.id && req.user.role !== 'owner') {
    return res.status(403).render('error', { title: 'Forbidden', message: "Developers can't edit another staff member's payment gateway — only the owner or that staff member can.", user: req.user });
  }
  for (const method of METHODS) {
    setGateway(target.id, method, {
      enabled: req.body[`enabled_${method}`] === 'on',
      fakeCredential: req.body[`cred_${method}`],
      statusNote: req.body[`note_${method}`],
    }, req.user.id);
  }
  log('info', 'payments', 'gateway config saved', { targetId: target.id, actorId: req.user.id });
  const qs = req.user.role === 'owner' && req.query.staffId ? `?staffId=${encodeURIComponent(req.query.staffId)}&saved=1` : '?saved=1';
  res.redirect('/gateway' + qs);
});

// ---------------------------------------------------------------- user-facing "Add Demo Credits"
router.get('/account/topup', requireRole('user'), (req, res) => {
  const methods = enabledGatewaysForStaffId(req.user.assigned_staff_id);
  res.render('topup', {
    title: 'Add Club Credits', user: req.user, balance: getBalance(req.user.id),
    methods, labels: METHOD_LABELS, error: null, activeNav: 'topup',
  });
});

router.post('/account/topup', requireRole('user'), (req, res) => {
  const method = req.body.method;
  const amount = Math.round(Number(req.body.amount));
  const render = (error) => {
    const methods = enabledGatewaysForStaffId(req.user.assigned_staff_id);
    return res.status(400).render('topup', { title: 'Add Club Credits', user: req.user, balance: getBalance(req.user.id), methods, labels: METHOD_LABELS, error, activeNav: 'topup' });
  };
  if (!req.user.assigned_staff_id) return render('You need to be routed to a support admin first — set an Admin ID from the support chat page.');
  if (!METHODS.includes(method)) return render('Choose a payment method.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return render('Enter a whole-credit amount between 1 and 100,000.');
  const staff = db.prepare("SELECT id FROM users WHERE staff_id = ? AND role IN ('admin','developer') AND disabled = 0").get(req.user.assigned_staff_id);
  if (!staff) return render('Your assigned admin is currently unavailable — contact support.');
  const enabled = getGateways(staff.id).find((g) => g.method === method && g.enabled);
  if (!enabled) return render(`${METHOD_LABELS[method]} isn't available from your admin right now.`);
  try {
    transferCredits(staff.id, req.user.id, amount, `Simulated ${METHOD_LABELS[method]} payment`, req.user.id, 'fake_payment');
  } catch (e) {
    if (e instanceof InsufficientBalanceError) return render(`This payment method is temporarily unable to process — contact support.`);
    throw e;
  }
  log('info', 'payments', 'fake payment purchase', { userId: req.user.id, method, amount, from: staff.id });
  res.redirect('/account?funded=1');
});
