const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-engine-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;

const store = require('../src/store');
const engine = require('../src/engine');
const { addDays, todayStr } = require('../src/dates');

function seedAccount(overrides = {}) {
  const base = {
    id: `acct_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Org',
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

test('isWinBackEligible: dormant 12mo purchaser, no booked event, stale touch -> eligible', () => {
  const account = seedAccount();
  assert.equal(engine.isWinBackEligible(account), true);
});

test('isWinBackEligible: excludes accounts with a currently booked future event', () => {
  const account = seedAccount({ eventBookedDate: addDays(todayStr(), 30) });
  assert.equal(engine.isWinBackEligible(account), false);
});

test('isWinBackEligible: excludes accounts touched within the last 60 days', () => {
  const account = seedAccount({ lastTouchDate: addDays(todayStr(), -10) });
  assert.equal(engine.isWinBackEligible(account), false);
});

test('isWinBackEligible: excludes purchases older than 12 months', () => {
  const account = seedAccount({ lastPurchaseDate: addDays(todayStr(), -400) });
  assert.equal(engine.isWinBackEligible(account), false);
});

test('isWinBackEligible: excludes opted-out accounts', () => {
  const account = seedAccount();
  store.updateAccount(account.id, { optedOut: true });
  assert.equal(engine.isWinBackEligible(store.getAccount(account.id)), false);
});

test('engine tick moves an eligible dormant account into Win-Back at the dormant stage', () => {
  const account = seedAccount({ id: 'acct_dormant_entry' });
  engine.runEngineTick();
  const updated = store.getAccount(account.id);
  assert.equal(updated.funnel, 'win_back');
  assert.equal(updated.stage, 'dormant');
});

test('engine tick drafts a Warm-Up touch when the anniversary is 60-90 days out', () => {
  const account = seedAccount({ id: 'acct_warmup', eventAnniversaryDate: addDays(todayStr(), 75) });
  engine.runEngineTick();
  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].stage, 'warm_up');
  assert.equal(touches[0].status, 'pending_review');
  assert.match(touches[0].body, /opt out/i);
});

test('Incentive stands down if Soft Ask already got a reply', () => {
  const account = seedAccount({ id: 'acct_replied', eventAnniversaryDate: addDays(todayStr(), 18) });
  store.updateAccount(account.id, { funnel: 'win_back', stage: 'soft_ask' });
  store.createTouch({ accountId: account.id, funnel: 'win_back', stage: 'soft_ask', subject: 'x', body: 'y', ownerId: 'audrey' });
  const softAskTouch = store.listTouches().find((t) => t.accountId === account.id);
  store.updateTouch(softAskTouch.id, { status: 'replied' });

  engine.runEngineTick();

  const touches = store.listTouches().filter((t) => t.accountId === account.id && t.stage === 'incentive');
  assert.equal(touches.length, 0);
});

test('Win-Back exits to Nurture when the anniversary passes with no reply after Escalation', () => {
  const account = seedAccount({ id: 'acct_exit', eventAnniversaryDate: addDays(todayStr(), -1) });
  store.updateAccount(account.id, { funnel: 'win_back', stage: 'escalation' });
  store.createTouch({ accountId: account.id, funnel: 'win_back', stage: 'escalation', subject: 'x', body: 'y', ownerId: 'audrey', kind: 'call_flag' });

  engine.runEngineTick();

  const updated = store.getAccount(account.id);
  assert.equal(updated.funnel, 'nurture');
});

test('A Nurture account that becomes dormant again re-enters Win-Back (loop logic)', () => {
  const account = seedAccount({ id: 'acct_loop', lastTouchDate: addDays(todayStr(), -100) });
  store.updateAccount(account.id, { funnel: 'nurture', stage: 'nurture' });

  engine.runEngineTick();

  const updated = store.getAccount(account.id);
  assert.equal(updated.funnel, 'win_back');
  assert.equal(updated.stage, 'dormant');
});

test('Proposal follow-up: Check-In fires at 3+ business days, DIY Fallback at 7+, gated by reply', () => {
  const account = seedAccount({
    id: 'acct_proposal',
    proposal: { sentDate: addDays(todayStr(), -5), eventDate: addDays(todayStr(), 60), outcome: null },
  });
  engine.runEngineTick();
  let touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.some((t) => t.stage === 'check_in'), true);

  store.updateAccount(account.id, { proposal: { ...store.getAccount(account.id).proposal, sentDate: addDays(todayStr(), -12) } });
  engine.runEngineTick();
  touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.some((t) => t.stage === 'diy_fallback'), true);
});

test('Proposal Final Anchor is timed to the event date, not a fixed interval', () => {
  const account = seedAccount({
    id: 'acct_final_anchor',
    proposal: { sentDate: addDays(todayStr(), -1), eventDate: addDays(todayStr(), 5), outcome: null },
  });
  engine.runEngineTick();
  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.some((t) => t.stage === 'final_anchor'), true);
});

test('Opted-out accounts are excluded from the engine entirely', () => {
  const account = seedAccount({ id: 'acct_opted_out' });
  store.updateAccount(account.id, { optedOut: true });
  const before = store.listTouches().length;
  engine.runEngineTick();
  assert.equal(store.listTouches().length, before);
  assert.equal(store.getAccount(account.id).funnel, 'none');
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
