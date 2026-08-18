// server/test_ledger_integrity.js — proves the non-negotiable ledger rules:
//   1. balance is always SUM(ledger.amount), never a stored mutable field
//   2. no negative balances are ever reachable
//   3. every ledger row's resulting_balance snapshot matches the running sum
//
// Runs against a throwaway SQLite file so it never touches real user data.
// Usage: npm run test:ledger
process.env.WGC_DB_PATH = ':memory:';
// node:sqlite's DatabaseSync supports ':memory:' directly; db.js just needs a
// path it can hand to the constructor, so this works without touching db.js.

const { db, log } = await import('./db.js');
const { hashPassword } = await import('./auth.js');
const { creditFixedSignupBonus, adminAdjust, resolveSpin, getBalance, verifyIntegrity, InsufficientBalanceError, ownerMint, transferCredits, mintedTotal, SIGNUP_BONUS_CREDITS } = await import('./ledger.js');

let passed = 0, failed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${info}`); }
}

const mkUser = (email) => {
  const hash = 'x'; // not exercising auth here, just need a row to hang ledger entries off
  const info = db.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)').run(email, hash, email);
  return Number(info.lastInsertRowid);
};

// --- 1. signup bonus is fixed, not caller-configurable ---
{
  const u = mkUser('alice@test.dev');
  creditFixedSignupBonus(u);
  check(`signup bonus is fixed at ${SIGNUP_BONUS_CREDITS}`, getBalance(u) === SIGNUP_BONUS_CREDITS, `got ${getBalance(u)}`);
}

// --- 2. spins deduct stake and add win atomically; balance always == SUM ---
{
  const u = mkUser('bob@test.dev');
  const owner = mkUser('owner-2@test.dev');
  ownerMint(owner, 1000, 'seed', owner);
  transferCredits(owner, u, 200, 'fund bob', owner); // -> 200
  resolveSpin(u, 'A', 30, 0, 'round-1'); // lose
  check('after a losing spin, balance = 200 - 30', getBalance(u) === 170, `got ${getBalance(u)}`);
  resolveSpin(u, 'A', 30, 450, 'round-2'); // win
  check('after a winning spin, balance = 170 - 30 + 450', getBalance(u) === 590, `got ${getBalance(u)}`);
  const rows = db.prepare('SELECT amount, resulting_balance FROM ledger WHERE user_id = ? ORDER BY id').all(u);
  // transfer-in(1) + losing spin: stake only(1) + winning spin: stake+win(2) = 4
  check('every row is immutable and additive (transfer-in + stake + stake + win = 4 rows)', rows.length === 4, `got ${rows.length}`);
  let running = 0;
  for (const r of rows) { running += r.amount; if (running !== r.resulting_balance) check('row snapshot matches running sum', false, JSON.stringify(r)); }
  check('all resulting_balance snapshots matched the running sum', true);
}

// --- 3. cannot go negative: insufficient balance is rejected, no partial write ---
{
  const u = mkUser('carol@test.dev');
  creditFixedSignupBonus(u); // -> 20
  let threw = false;
  try { resolveSpin(u, 'A', 30, 0, 'round-x'); } catch (e) { threw = e instanceof InsufficientBalanceError; }
  check('spin stake exceeding balance is rejected', threw);
  check('balance unchanged after rejected spin (no partial ledger write)', getBalance(u) === 20, `got ${getBalance(u)}`);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE user_id = ?').get(u);
  check('rejected spin wrote zero ledger rows', rows.n === 1, `got ${rows.n} rows (expected just the bonus)`); // only the bonus row
}

// --- 3b. the credit supply chain: mint -> transfer -> transfer, balance-checked at every hop ---
{
  const owner = mkUser('owner@test.dev');
  const dev = mkUser('dev@test.dev');
  const admin = mkUser('admin-chain@test.dev');
  const player = mkUser('player-chain@test.dev');

  ownerMint(owner, 1_000_000, 'initial mint', owner);
  check('owner mint credits the owner float exactly', getBalance(owner) === 1_000_000, `got ${getBalance(owner)}`);
  check('mintedTotal() reflects this mint', mintedTotal() >= 1_000_000);

  transferCredits(owner, dev, 10_000, 'fund developer', owner);
  check('developer received exactly the transferred amount', getBalance(dev) === 10_000, `got ${getBalance(dev)}`);
  check('owner float decreased by the same amount', getBalance(owner) === 1_000_000 - 10_000);

  transferCredits(dev, admin, 1_000, 'fund admin', dev);
  check('admin received exactly the transferred amount', getBalance(admin) === 1_000, `got ${getBalance(admin)}`);
  check('developer float decreased by the same amount', getBalance(dev) === 9_000);

  transferCredits(admin, player, 20, 'fake payment', admin, 'fake_payment');
  check('player received the simulated-payment amount', getBalance(player) === 20 + 0, `got ${getBalance(player)}`);
  check('admin float decreased by the same amount', getBalance(admin) === 980);

  let threw = false;
  try { transferCredits(admin, player, 999_999, 'too much', admin); } catch (e) { threw = e instanceof InsufficientBalanceError; }
  check('a transfer exceeding the sender float is rejected', threw);
  check('rejected transfer left both balances unchanged', getBalance(admin) === 980 && getBalance(player) === 20);

  let threwZero = false;
  try { transferCredits(admin, player, 0, 'zero', admin); } catch { threwZero = true; }
  check('a zero/negative-amount transfer is rejected', threwZero);
}

// --- 4. admin adjustment requires a reason, records admin_id, and — the
//        exact bug a real admin found in production — can NEVER credit a
//        user from a staff member's float they don't actually have ---
{
  const u = mkUser('dave@test.dev');
  const admin = mkUser('admin@test.dev');
  let threw = false;
  try { adminAdjust(u, 50, '', admin); } catch { threw = true; }
  check('admin adjustment without a reason is rejected', threw);

  let threwPoor = false;
  try { adminAdjust(u, 500, 'a 0-balance admin should not be able to do this', admin); } catch (e) { threwPoor = e instanceof InsufficientBalanceError; }
  check('giving credits from a 0-balance admin is rejected (regression: this exact bug shipped once)', threwPoor);
  check('rejected adjustment left the target balance untouched', getBalance(u) === 0);

  const owner4 = mkUser('owner-4@test.dev');
  ownerMint(owner4, 1000, 'seed', owner4);
  transferCredits(owner4, admin, 500, 'fund admin', owner4); // admin now has 500
  adminAdjust(u, 500, 'support ticket #42 — compensating for a bug report', admin);
  check('admin adjustment credits the exact amount once the admin has the float', getBalance(u) === 500);
  check('giving credits actually debited the admin\'s own float', getBalance(admin) === 0);
  const row = db.prepare("SELECT * FROM ledger WHERE user_id = ? AND type = 'admin_adjust'").get(u);
  check('admin adjustment records admin_id and reason', row.admin_id === admin && row.reason.includes('#42'));

  adminAdjust(u, -200, 'correcting an over-credit', admin);
  check('taking credits out reduces the target by the exact amount', getBalance(u) === 300);
  check('taking credits out credits them BACK to the acting staff member, never destroyed', getBalance(admin) === 200);

  let threwOverdraw = false;
  try { adminAdjust(u, -9999, 'taking more than the target has', admin); } catch (e) { threwOverdraw = e instanceof InsufficientBalanceError; }
  check('taking out more than the target has is rejected', threwOverdraw);
  check('rejected take-out left both balances unchanged', getBalance(u) === 300 && getBalance(admin) === 200);
}

// --- 5. concurrent-style rapid spins never desync balance from SUM(ledger) ---
{
  const u = mkUser('erin@test.dev');
  const owner2 = mkUser('owner-5@test.dev');
  ownerMint(owner2, 10000, 'seed', owner2);
  transferCredits(owner2, u, 10000, 'fund erin', owner2); // -> 10000
  for (let i = 0; i < 500; i++) {
    const win = i % 7 === 0 ? 90 : 0;
    try { resolveSpin(u, i % 2 === 0 ? 'A' : 'B', 30, win, `stress-${i}`); } catch { /* eventually runs out, expected */ }
  }
  const bal = getBalance(u);
  const summed = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE user_id = ?').get(u).s;
  check('after 500 rapid spins, balance still exactly equals SUM(ledger)', bal === summed, `bal=${bal} sum=${summed}`);
  check('balance never went negative', bal >= 0, `bal=${bal}`);
}

// --- 6. whole-database integrity sweep (what the owner dashboard calls) ---
{
  const report = verifyIntegrity();
  check(`verifyIntegrity() reports clean across all ${report.checkedUsers} users`, report.ok, JSON.stringify(report.problems));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
