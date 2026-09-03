// Opt-out, end-to-end (Prompt 8 Item 5 — compliance-critical).
// -----------------------------------------------------------------
// Two layers of proof, both required:
//   1. Engine-layer: an opted-out account is excluded from ALL THREE
//      motions (Win-Back, Proposal Follow-Up, Nurture) on the very next
//      tick, and stays excluded until explicitly cleared.
//   2. HTTP-layer: the actual public unsubscribe route and the admin
//      clear-optout route, hit as real requests against the running app —
//      not just the underlying store function — since that's the path a
//      real client and a real admin actually use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-optout-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;

const store = require('../src/store');
const engine = require('../src/engine');
const app = require('../src/server');
const { startServer, stopServer } = require('./helpers/http');
const { addDays, todayStr } = require('../src/dates');

store.updateOwner('audrey', { calendlyLink: 'https://calendly.com/audrey-impact4good' });
store.updateOwner('nick', { calendlyLink: 'https://calendly.com/nick-impact4good' });

function seedAccount(overrides = {}) {
  const uid = Math.random().toString(36).slice(2, 8);
  const base = {
    id: `acct_${uid}`,
    name: `Test Org ${uid}`,
    contactName: 'Jamie',
    contactEmail: 'jamie@example.com',
    ownerId: 'audrey',
    lastPurchaseDate: addDays(todayStr(), -200),
    eventBookedDate: '',
    eventAnniversaryDate: '',
    lastTouchDate: addDays(todayStr(), -100),
  };
  const merged = { ...base, ...overrides };
  store.syncAccounts([merged]);
  return store.getAccount(merged.id);
}

// ---------- 1. Engine-layer suppression, all three motions ----------

test('Opted-out mid Win-Back: no further Win-Back touch is drafted on the next tick', () => {
  const account = seedAccount({ id: 'acct_optout_wb', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick(); // drafts Warm-Up
  const before = store.listTouches().filter((t) => t.accountId === account.id).length;
  assert.equal(before, 1, 'sanity: Warm-Up should have drafted first');

  store.setOptOut(account.id, true);
  store.updateAccount(account.id, { eventAnniversaryDate: addDays(todayStr(), 38) }); // would otherwise trigger Soft Ask
  engine.runEngineTick();

  const after = store.listTouches().filter((t) => t.accountId === account.id).length;
  assert.equal(after, before, 'no new touch should be drafted once opted out, even though the account would otherwise be due for Soft Ask');
  assert.equal(store.getAccount(account.id).optedOut, true);
});

test('Opted-out with an open proposal: no Proposal Follow-Up touch is drafted', () => {
  const account = seedAccount({
    id: 'acct_optout_proposal',
    proposal: { sentDate: addDays(todayStr(), -5), eventDate: addDays(todayStr(), 60), outcome: null },
  });
  store.setOptOut(account.id, true);
  engine.runEngineTick();

  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 0, 'Check-In should not fire for an opted-out account even with a live open proposal');
});

test('Opted-out in Nurture: no nurture check-in is drafted', () => {
  const account = seedAccount({ id: 'acct_optout_nurture', lastTouchDate: addDays(todayStr(), -200) });
  store.updateAccount(account.id, { funnel: 'nurture', stage: 'nurture' });
  store.setOptOut(account.id, true);
  engine.runEngineTick();

  const touches = store.listTouches().filter((t) => t.accountId === account.id && t.funnel === 'nurture');
  assert.equal(touches.length, 0);
});

test('Opt-out is reversible ONLY via the explicit clear — the engine picks the account back up afterward', () => {
  const account = seedAccount({ id: 'acct_optout_clear', eventAnniversaryDate: addDays(todayStr(), 75) });
  store.setOptOut(account.id, true);
  engine.runEngineTick();
  assert.equal(store.listTouches().filter((t) => t.accountId === account.id).length, 0, 'still suppressed');

  store.setOptOut(account.id, false); // the manual clear
  engine.runEngineTick();

  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 1, 'once cleared, the account is evaluated fresh and Warm-Up drafts normally');
  assert.equal(store.getAccount(account.id).optedOut, false);
});

// ---------- 2. HTTP-layer: the real routes, hit as real requests ----------

test('HTTP: the public unsubscribe link immediately opts an account out, and the engine honors it on the very next tick', async () => {
  const account = seedAccount({ id: 'acct_http_unsub', eventAnniversaryDate: addDays(todayStr(), 75) });
  const { listener, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/unsubscribe/${account.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /unsubscribed/i);

    assert.equal(store.getAccount(account.id).optedOut, true, 'store reflects the opt-out immediately — no delay, no confirmation step');

    engine.runEngineTick();
    assert.equal(store.listTouches().filter((t) => t.accountId === account.id).length, 0, 'no touch drafted post-unsubscribe');
  } finally {
    await stopServer(listener);
  }
});

test('HTTP: clearing an opt-out requires admin — a viewer is rejected, an admin succeeds', async () => {
  const account = seedAccount({ id: 'acct_http_clear', eventAnniversaryDate: addDays(todayStr(), 75) });
  store.setOptOut(account.id, true);
  const { listener, baseUrl } = await startServer(app);
  try {
    const viewerRes = await fetch(`${baseUrl}/api/accounts/${account.id}/clear-optout`, { method: 'POST', headers: { 'X-User-Id': 'audrey' } });
    assert.equal(viewerRes.status, 403);
    assert.equal(store.getAccount(account.id).optedOut, true, 'still opted out — a viewer cannot clear it');

    const adminRes = await fetch(`${baseUrl}/api/accounts/${account.id}/clear-optout`, { method: 'POST', headers: { 'X-User-Id': 'shawn' } });
    assert.equal(adminRes.status, 200);
    assert.equal(store.getAccount(account.id).optedOut, false);
  } finally {
    await stopServer(listener);
  }
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
