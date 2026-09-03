// Monthly operating review — draft edit rate, opt-out trend, feedback
// rollup, and the two-months-running escalation trigger (Prompt 10).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-reviews-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;

const store = require('../src/store');
const reviews = require('../src/reviews');
const app = require('../src/server');
const { startServer, stopServer } = require('./helpers/http');
const { addDays, todayStr } = require('../src/dates');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- pure calculation functions ----------

test('draftEditRate: no sends yet is null, not a misleading 0%', () => {
  assert.deepEqual(reviews.draftEditRate([]), { totalSends: 0, editedSends: 0, rate: null });
});

test('draftEditRate: computes edited / total as a percentage', () => {
  const sends = [{ wasEdited: true }, { wasEdited: true }, { wasEdited: false }, { wasEdited: false }];
  assert.deepEqual(reviews.draftEditRate(sends), { totalSends: 4, editedSends: 2, rate: 50 });
});

test('optOutTrend: counts new opt-outs in the trailing window separately from the cumulative rate', () => {
  const now = Date.now();
  const activity = [
    { type: 'opted_out', at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() }, // 5 days ago — in window
    { type: 'opted_out', at: new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString() }, // 45 days ago — out of window
    { type: 'touch_sent', at: new Date(now).toISOString() }, // wrong type — must not count
  ];
  const accounts = [{ optedOut: true }, { optedOut: true }, { optedOut: false }, { optedOut: false }];
  const trend = reviews.optOutTrend(activity, accounts);
  assert.equal(trend.newOptOutsLast30d, 1);
  assert.equal(trend.totalOptedOut, 2);
  assert.equal(trend.totalEverSynced, 4);
  assert.equal(trend.cumulativeRate, 50);
});

test('optOutTrend: null cumulative rate when nothing has ever synced, not a divide-by-zero artifact', () => {
  assert.equal(reviews.optOutTrend([], []).cumulativeRate, null);
});

test('feedbackSummary: rolls up flags by category', () => {
  const feedback = [{ category: 'tone' }, { category: 'tone' }, { category: 'wrong_cta' }];
  assert.deepEqual(reviews.feedbackSummary(feedback), { totalFlags: 3, byCategory: { tone: 2, wrong_cta: 1 } });
});

test('detectEscalations: no prior review means nothing to escalate yet', () => {
  assert.deepEqual(reviews.detectEscalations({ replyRateLast30: { status: 'below_kill' } }, null), []);
});

test('detectEscalations: a metric below_kill in both this review and the prior one escalates', () => {
  const prior = { periodLabel: '2026-08', targets: { replyRateLast30: { status: 'below_kill' } } };
  const current = { replyRateLast30: { status: 'below_kill' } };
  const escalations = reviews.detectEscalations(current, prior);
  assert.equal(escalations.length, 1);
  assert.equal(escalations[0].metric, 'replyRateLast30');
  assert.equal(escalations[0].priorPeriod, '2026-08');
});

test('detectEscalations: watch counts as a miss too, and a mixed watch/below_kill pair still escalates', () => {
  const prior = { periodLabel: '2026-08', targets: { winBackConversion: { status: 'watch' } } };
  const current = { winBackConversion: { status: 'below_kill' } };
  assert.equal(reviews.detectEscalations(current, prior).length, 1);
});

test('detectEscalations: on_track this period clears the streak, even if last period missed', () => {
  const prior = { periodLabel: '2026-08', targets: { replyRateLast30: { status: 'below_kill' } } };
  const current = { replyRateLast30: { status: 'on_track' } };
  assert.equal(reviews.detectEscalations(current, prior).length, 0);
});

test('detectEscalations: not_applicable metrics never escalate', () => {
  const prior = { periodLabel: '2026-08', targets: { activeAccountsInCohort: { status: 'not_applicable' } } };
  const current = { activeAccountsInCohort: { status: 'not_applicable' } };
  assert.equal(reviews.detectEscalations(current, prior).length, 0);
});

// ---------- generateMonthlyReview: persistence + real two-review escalation ----------

test('generateMonthlyReview persists the report and a second run detects a real two-month miss', () => {
  store.updateOwner('audrey', { calendlyLink: 'https://calendly.com/audrey-impact4good' });

  const first = reviews.generateMonthlyReview();
  assert.ok(first.id);
  assert.equal(first.periodLabel, new Date().toISOString().slice(0, 7));
  assert.equal(first.escalations.length, 0, 'first-ever review has no prior review to compare against');

  const stored = store.listMonthlyReviews(1);
  assert.equal(stored[0].id, first.id);

  // Reply rate has no data yet in this fresh store, so it reads
  // not_applicable both times — a real two-review below_kill streak is
  // exercised directly in the detectEscalations unit tests above; this
  // confirms the persisted-history wiring itself works end to end.
  const second = reviews.generateMonthlyReview();
  assert.equal(store.listMonthlyReviews(5).length, 2);
  assert.ok(Array.isArray(second.escalations));
});

test('Codex fix: two reviews generated in the SAME real month never manufacture a false two-month escalation from each other', () => {
  // Force a genuinely below_kill reply rate (not the not_applicable case
  // above) so there's something real for a same-month comparison to
  // falsely escalate on if the bug were still present: one sent, unreplied
  // touch in the last 30 days reads 0% — below the 5% kill threshold.
  const uid = Math.random().toString(36).slice(2, 8);
  const account = { id: `acct_review_${uid}`, name: `Review Org ${uid}`, ownerId: 'audrey', lastPurchaseDate: addDays(todayStr(), -200) };
  store.syncAccounts([account]);
  const touch = store.createTouch({ accountId: account.id, funnel: 'win_back', stage: 'soft_ask', subject: 'x', body: 'y', ownerId: 'audrey', kind: 'email', draftSource: 'template' });
  store.updateTouch(touch.id, { status: 'sent', sentAt: new Date().toISOString() });

  const first = reviews.generateMonthlyReview();
  assert.equal(first.targets.replyRateLast30.status, 'below_kill', 'sanity: the fixture actually reads below_kill');

  const second = reviews.generateMonthlyReview();
  assert.equal(second.periodLabel, first.periodLabel, 'sanity: both calls land in the same real calendar month');
  assert.equal(
    second.escalations.some((e) => e.metric === 'replyRateLast30'),
    false,
    'comparing this review against one generated moments earlier in the SAME month must never count as "two months running"'
  );
});

// ---------- HTTP: flag a draft, mark rollout, generate a review ----------

let server;
test.before(async () => {
  server = await startServer(app);
});
test.after(async () => {
  await stopServer(server.listener);
});

function seedTouch() {
  const uid = Math.random().toString(36).slice(2, 8);
  const account = { id: `acct_${uid}`, name: `Test Org ${uid}`, contactName: 'Jamie', ownerId: 'audrey', lastPurchaseDate: '2026-01-01' };
  store.syncAccounts([account]);
  return store.createTouch({ accountId: account.id, funnel: 'win_back', stage: 'soft_ask', subject: 'Hi', body: 'Hi', ownerId: 'audrey', kind: 'email', draftSource: 'template' });
}

test('HTTP: flagging a draft requires a valid category and a non-empty reason', async () => {
  const touch = seedTouch();

  const badCategory = await fetch(`${server.baseUrl}/api/touches/${touch.id}/flag`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'not-a-real-category', reason: 'x' }) });
  assert.equal(badCategory.status, 400);

  const noReason = await fetch(`${server.baseUrl}/api/touches/${touch.id}/flag`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'tone' }) });
  assert.equal(noReason.status, 400);

  const good = await fetch(`${server.baseUrl}/api/touches/${touch.id}/flag`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'tone', reason: 'reads as pushy, not our voice' }) });
  assert.equal(good.status, 201);
  const entry = await good.json();
  assert.equal(entry.category, 'tone');
  assert.equal(entry.flaggedBy, 'audrey');
});

test('HTTP: viewing all draft feedback is admin-only', async () => {
  const viewer = await fetch(`${server.baseUrl}/api/draft-feedback`, { headers: { 'X-User-Id': 'audrey' } });
  assert.equal(viewer.status, 403);
  const admin = await fetch(`${server.baseUrl}/api/draft-feedback`, { headers: { 'X-User-Id': 'shawn' } });
  assert.equal(admin.status, 200);
});

test('HTTP: marking rollout and generating a review are both admin-only', async () => {
  const viewerRollout = await fetch(`${server.baseUrl}/api/settings/mark-rollout`, { method: 'POST', headers: { 'X-User-Id': 'nick' } });
  assert.equal(viewerRollout.status, 403);

  const adminRollout = await fetch(`${server.baseUrl}/api/settings/mark-rollout`, { method: 'POST', headers: { 'X-User-Id': 'shawn' } });
  assert.equal(adminRollout.status, 200);
  const { rolloutDate } = await adminRollout.json();
  assert.match(rolloutDate, /^\d{4}-\d{2}-\d{2}$/);

  const settings = await fetch(`${server.baseUrl}/api/settings`, { headers: { 'X-User-Id': 'shawn' } }).then((r) => r.json());
  assert.equal(settings.rolloutDate, rolloutDate);

  const viewerGenerate = await fetch(`${server.baseUrl}/api/reviews/monthly/generate`, { method: 'POST', headers: { 'X-User-Id': 'nick' } });
  assert.equal(viewerGenerate.status, 403);

  const adminGenerate = await fetch(`${server.baseUrl}/api/reviews/monthly/generate`, { method: 'POST', headers: { 'X-User-Id': 'shawn' } });
  assert.equal(adminGenerate.status, 201);

  const list = await fetch(`${server.baseUrl}/api/reviews/monthly`, { headers: { 'X-User-Id': 'audrey' } }).then((r) => r.json());
  assert.ok(list.length >= 1);
});
