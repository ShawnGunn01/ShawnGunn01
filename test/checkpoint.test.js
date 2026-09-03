// Pilot checkpoint mode (Prompt 9 Item 3): "nothing auto-progresses
// without a human check" during the observation window. Proves both that
// the gate actually holds when on, and that default (off) behavior is
// unchanged from Prompts 5-8 — this feature must be a pure add, not a
// regression risk to everything already shipped.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-checkpoint-test-'));
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

test('Default (checkpointMode off): a due stage still drafts and advances immediately, same as every prior prompt', () => {
  store.setSetting('checkpointMode', false);
  const account = seedAccount({ id: 'acct_no_checkpoint', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].stage, 'warm_up');
  assert.equal(store.getAccount(account.id).stage, 'warm_up');
  assert.equal(store.listCheckpoints().length, 0, 'no checkpoint should exist when the mode is off');
});

test('checkpointMode on: a due stage transition is proposed as a pending checkpoint, NOT drafted, and the account does not advance', () => {
  store.setSetting('checkpointMode', true);
  const account = seedAccount({ id: 'acct_checkpoint_pending', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();

  assert.equal(store.listTouches().filter((t) => t.accountId === account.id).length, 0, 'nothing should auto-progress while checkpoint mode is on');
  // Entering Win-Back at 'dormant' is funnel ASSIGNMENT (evaluateAccount),
  // not a drafted stage transition — that part is unaffected by the gate.
  // What must NOT happen is advancing past dormant to warm_up without approval.
  assert.equal(store.getAccount(account.id).stage, 'dormant');

  const pending = store.listCheckpoints({ status: 'pending' }).filter((c) => c.accountId === account.id);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].funnel, 'win_back');
  assert.equal(pending[0].stage, 'warm_up');
});

test('checkpointMode on: repeated ticks do not pile up duplicate pending checkpoints for the same transition', () => {
  const account = seedAccount({ id: 'acct_checkpoint_dedupe', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  engine.runEngineTick();
  engine.runEngineTick();
  const pending = store.listCheckpoints({ status: 'pending' }).filter((c) => c.accountId === account.id);
  assert.equal(pending.length, 1);
});

test('Approving a checkpoint drafts the touch and advances the stage, through the same guardrail gate as normal drafting', () => {
  const account = seedAccount({ id: 'acct_checkpoint_approve', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const checkpoint = store.listCheckpoints({ status: 'pending' }).find((c) => c.accountId === account.id);
  assert.ok(checkpoint);

  const result = engine.approveCheckpoint(checkpoint.id, 'shawn');
  assert.equal(result.queued, true);

  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].stage, 'warm_up');
  assert.equal(store.getAccount(account.id).stage, 'warm_up');
  assert.equal(store.getCheckpoint(checkpoint.id).status, 'approved');
  assert.equal(store.getCheckpoint(checkpoint.id).decidedBy, 'shawn');
});

test('Rejecting a checkpoint drafts nothing and leaves the account unchanged', () => {
  const account = seedAccount({ id: 'acct_checkpoint_reject', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const checkpoint = store.listCheckpoints({ status: 'pending' }).find((c) => c.accountId === account.id);

  engine.rejectCheckpoint(checkpoint.id, 'shawn', 'anniversary date looks wrong, checking with Salesforce first');
  assert.equal(store.listTouches().filter((t) => t.accountId === account.id).length, 0);
  assert.equal(store.getAccount(account.id).stage, 'dormant', 'stage must stay at dormant — never advances to warm_up on a rejection');
  assert.equal(store.getCheckpoint(checkpoint.id).status, 'rejected');
  assert.equal(store.getCheckpoint(checkpoint.id).reason, 'anniversary date looks wrong, checking with Salesforce first');
});

test('Codex fix: a rejected checkpoint does NOT reappear on the next engine tick — rejection holds until the underlying data changes', () => {
  const account = seedAccount({ id: 'acct_checkpoint_reject_persist', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const checkpoint = store.listCheckpoints({ status: 'pending' }).find((c) => c.accountId === account.id);
  engine.rejectCheckpoint(checkpoint.id, 'shawn', 'not yet');

  // Run several more ticks — nothing about the account changed, so the
  // same warm_up transition would be "due" every single time.
  engine.runEngineTick();
  engine.runEngineTick();
  engine.runEngineTick();

  const allCheckpointsForAccount = store.listCheckpoints().filter((c) => c.accountId === account.id);
  assert.equal(allCheckpointsForAccount.length, 1, 'no new checkpoint should be proposed for the same rejected transition');
  assert.equal(allCheckpointsForAccount[0].status, 'rejected');
  assert.equal(store.listTouches().filter((t) => t.accountId === account.id).length, 0);
});

test('Approving or rejecting an already-decided checkpoint is rejected, not silently repeated', () => {
  const account = seedAccount({ id: 'acct_checkpoint_double', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const checkpoint = store.listCheckpoints({ status: 'pending' }).find((c) => c.accountId === account.id);
  engine.approveCheckpoint(checkpoint.id, 'shawn');

  assert.throws(() => engine.approveCheckpoint(checkpoint.id, 'shawn'), /already approved/);
  assert.throws(() => engine.rejectCheckpoint(checkpoint.id, 'shawn'), /already approved/);
});

// ---------- HTTP: admin-only controls ----------

test('HTTP: only an admin can toggle checkpoint mode or decide a checkpoint', async () => {
  const account = seedAccount({ id: 'acct_checkpoint_http', eventAnniversaryDate: addDays(todayStr(), 75) });
  const { listener, baseUrl } = await startServer(app);
  try {
    const viewerToggle = await fetch(`${baseUrl}/api/settings/checkpoint-mode`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    assert.equal(viewerToggle.status, 403);

    const adminToggle = await fetch(`${baseUrl}/api/settings/checkpoint-mode`, { method: 'POST', headers: { 'X-User-Id': 'shawn', 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(adminToggle.status, 200);
    assert.equal((await adminToggle.json()).checkpointMode, true);

    engine.runEngineTick();
    const checkpoint = store.listCheckpoints({ status: 'pending' }).find((c) => c.accountId === account.id);
    assert.ok(checkpoint);

    const viewerApprove = await fetch(`${baseUrl}/api/checkpoints/${checkpoint.id}/approve`, { method: 'POST', headers: { 'X-User-Id': 'audrey' } });
    assert.equal(viewerApprove.status, 403);

    const adminApprove = await fetch(`${baseUrl}/api/checkpoints/${checkpoint.id}/approve`, { method: 'POST', headers: { 'X-User-Id': 'shawn' } });
    assert.equal(adminApprove.status, 200);
  } finally {
    await stopServer(listener);
  }
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
