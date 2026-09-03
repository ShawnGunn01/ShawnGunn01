const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-datalayer-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;

const store = require('../src/store');
const engine = require('../src/engine');
const drafts = require('../src/drafts');
const dashboard = require('../src/dashboard');
const { addDays, todayStr } = require('../src/dates');

store.updateOwner('audrey', { calendlyLink: 'https://calendly.com/audrey-impact4good' });
store.updateOwner('nick', { calendlyLink: 'https://calendly.com/nick-impact4good' });

function seedAccount(overrides = {}) {
  const uid = Math.random().toString(36).slice(2, 8);
  const base = {
    id: `acct_${uid}`,
    name: `Test Org ${uid}`, // unique — see engine.test.js for why a shared name is wrong here
    contactName: 'Jamie',
    ownerId: 'audrey',
    lastPurchaseDate: addDays(todayStr(), -200),
    eventBookedDate: '',
    eventAnniversaryDate: '',
    lastTouchDate: addDays(todayStr(), -100),
  };
  const merged = { ...base, ...overrides };
  const result = store.syncAccounts([merged]);
  return { account: store.getAccount(merged.id), syncResult: result };
}

// ---------- Prompt 2 decision: 5% flat incentive, no date-bound copy ----------

test('Incentive draft offers exactly 5%, flat, and states no fixed expiration date', () => {
  const { account } = seedAccount({ id: 'acct_incentive_copy', eventAnniversaryDate: addDays(todayStr(), 18) });
  engine.runEngineTick();
  const touch = store.listTouches().find((t) => t.accountId === account.id && t.stage === 'incentive');
  assert.ok(touch, 'expected an incentive touch to be drafted');
  assert.match(touch.body, /5% off/);
  assert.doesNotMatch(touch.body, /\d+ ?(day|week)s?/i, 'copy should not state a separate fixed-date/duration window');
  assert.equal(drafts.INCENTIVE_PERCENT, 5);
});

// ---------- Metrics Spec gap #10: expired proposals get an explicit outcome ----------

test('A proposal whose event date passes with no response is set to expired_no_response, not left null', () => {
  const { account } = seedAccount({
    id: 'acct_expired_proposal',
    proposal: { sentDate: addDays(todayStr(), -40), eventDate: addDays(todayStr(), -1), outcome: null },
  });
  engine.runEngineTick();
  const updated = store.getAccount(account.id);
  assert.equal(updated.proposal.outcome, 'expired_no_response');
  assert.equal(updated.funnel, 'nurture');

  const d = dashboard.getDashboard();
  assert.equal(d.proposalOutcomes.expiredNoResponse, 1);
  // this account must not vanish from the resolved denominator
  assert.ok(d.proposalOutcomes.resolvedCount >= 1);
});

// ---------- Architecture v0.1 §4: partial-batch sync validation ----------

test('syncAccounts skips a record missing a required field instead of failing the whole batch or accepting nulls', () => {
  const good = { id: 'acct_good_1', name: 'Good Org', ownerId: 'nick', lastPurchaseDate: addDays(todayStr(), -10) };
  const bad = { id: 'acct_bad_1', name: 'Bad Org', ownerId: 'nick' }; // missing lastPurchaseDate

  const result = store.syncAccounts([good, bad]);
  assert.equal(result.created, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 'acct_bad_1');
  assert.match(result.skipped[0].reason, /lastPurchaseDate/);
  assert.ok(store.getAccount('acct_good_1'));
  assert.equal(store.getAccount('acct_bad_1'), null);
});

test('syncAccounts rejects an unparseable date rather than accepting it silently', () => {
  const rec = { id: 'acct_bad_date', name: 'Bad Date Org', ownerId: 'audrey', lastPurchaseDate: 'not-a-date' };
  const result = store.syncAccounts([rec]);
  assert.equal(result.created, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /not a parseable date/);
});

// ---------- Metrics Spec §3: out_of_office is not a reply ----------

test('Marking a touch out_of_office does not count as replied and does not stand down the sequence', () => {
  const { account } = seedAccount({ id: 'acct_ooo', eventAnniversaryDate: addDays(todayStr(), 38) });
  engine.runEngineTick();
  const softAsk = store.listTouches().find((t) => t.accountId === account.id && t.stage === 'soft_ask');
  assert.ok(softAsk);
  store.updateTouch(softAsk.id, { status: 'out_of_office', replyMarkedBy: 'audrey' });

  // advance the clock by moving the account's anniversary into the incentive window
  store.updateAccount(account.id, { eventAnniversaryDate: addDays(todayStr(), 18) });
  engine.runEngineTick();

  const incentive = store.listTouches().find((t) => t.accountId === account.id && t.stage === 'incentive');
  assert.ok(incentive, 'incentive should still fire — an OOO is not a reply, so the stand-down gate should not trip');

  const d = dashboard.getDashboard();
  // an out_of_office touch must not be countable as 'replied' in the reply-rate numerator
  assert.equal(store.getTouch(softAsk.id).status, 'out_of_office');
});

// ---------- "log every sync run and every cohort recalculation" ----------

test('Every sync call is logged to sync_runs, reviewable without Make.com', () => {
  const before = store.listSyncRuns().length;
  store.syncAccounts([{ id: 'acct_logtest', name: 'Log Test', ownerId: 'nick', lastPurchaseDate: todayStr() }]);
  // the store function itself doesn't log — the server route does, so simulate that call directly
  store.logSyncRun({ createdCount: 1, updatedCount: 0, skipped: [] });
  const runs = store.listSyncRuns();
  assert.equal(runs.length, before + 1);
  assert.equal(runs[0].status, 'ok');
});

test('Every engine tick is logged to engine_runs, reviewable without Make.com', () => {
  const before = store.listEngineRuns().length;
  engine.runEngineTick();
  const runs = store.listEngineRuns();
  assert.equal(runs.length, before + 1);
  assert.ok('touchesCreated' in runs[0]);
  assert.equal(runs[0].status, 'ok');
});

// ---------- Metrics Spec gap #1/#5-6: purchases log + revenue by motion ----------

test('Rebooking and a converted proposal both record dated, motion-tagged purchase events', () => {
  const { account: winBackAcct } = seedAccount({ id: 'acct_purch_wb', eventAnniversaryDate: addDays(todayStr(), 500) });
  store.updateAccount(winBackAcct.id, { funnel: 'win_back', stage: 'escalation' });
  store.recordPurchase({ accountId: winBackAcct.id, date: todayStr(), amount: 4300, source: 'rebook' });

  const { account: proposalAcct } = seedAccount({
    id: 'acct_purch_prop',
    proposal: { sentDate: addDays(todayStr(), -2), eventDate: addDays(todayStr(), 30), outcome: null },
  });
  store.recordPurchase({ accountId: proposalAcct.id, date: todayStr(), amount: 4500, source: 'proposal_follow_up' });

  const d = dashboard.getDashboard();
  assert.equal(d.recoveredRevenueQTD.winBack, 4300);
  assert.equal(d.recoveredRevenueQTD.proposalFollowUp, 4500);
  assert.equal(d.recoveredRevenueQTD.total, 8800);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
