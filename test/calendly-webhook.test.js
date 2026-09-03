// Calendly webhook -> auto "Rebooked" (Prompt 8 Item 4), hit as a real
// HTTP request with a real HMAC signature — the actual path Calendly would
// call, not just the parsing function in isolation (that's covered in
// test/calendly.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-calendly-webhook-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;
process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'test-signing-key';

const store = require('../src/store');
const app = require('../src/server');
const { startServer, stopServer } = require('./helpers/http');
const { addDays, todayStr } = require('../src/dates');

function sign(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', process.env.CALENDLY_WEBHOOK_SIGNING_KEY).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function seedAccount({ funnel, stage, ...overrides } = {}) {
  const uid = Math.random().toString(36).slice(2, 8);
  const account = {
    id: `acct_${uid}`,
    name: `Test Org ${uid}`,
    contactName: 'Renee',
    ownerId: 'audrey',
    lastPurchaseDate: addDays(todayStr(), -200),
    ...overrides,
  };
  // funnel/stage are LOCAL fields — store.syncAccounts (correctly) never
  // sets them from a sync payload, a new account always lands at funnel
  // 'none'. Set them explicitly afterward to seed mid-sequence state.
  store.syncAccounts([account]);
  if (funnel !== undefined || stage !== undefined) {
    store.updateAccount(account.id, { ...(funnel !== undefined ? { funnel } : {}), ...(stage !== undefined ? { stage } : {}) });
  }
  return store.getAccount(account.id);
}

let server;
test.before(async () => {
  server = await startServer(app);
});
test.after(async () => {
  await stopServer(server.listener);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('A signed invitee.created event auto-marks the tracked account Rebooked, no manual step', async () => {
  const account = seedAccount({ id: 'acct_calendly_1', funnel: 'win_back', stage: 'soft_ask' });
  const rawBody = JSON.stringify({ event: 'invitee.created', payload: { tracking: { utm_content: account.id } } });

  const res = await fetch(`${server.baseUrl}/api/webhooks/calendly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': sign(rawBody) },
    body: rawBody,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rebooked, true);

  const updated = store.getAccount(account.id);
  assert.equal(updated.funnel, 'none', 'rebooked accounts exit the funnel entirely, same as a manual rebook');
  assert.equal(updated.rebookedAt.at(-1).source, 'calendly_webhook');
  assert.ok(store.listPurchases(account.id).length >= 1, 'a purchase row is recorded, same as a manual rebook (Metrics Spec gap #1)');
});

test('An unsigned/incorrectly-signed request is rejected — no account is touched', async () => {
  const account = seedAccount({ id: 'acct_calendly_bad_sig', funnel: 'win_back', stage: 'soft_ask' });
  const rawBody = JSON.stringify({ event: 'invitee.created', payload: { tracking: { utm_content: account.id } } });

  const res = await fetch(`${server.baseUrl}/api/webhooks/calendly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': 't=1,v1=deadbeef' },
    body: rawBody,
  });
  assert.equal(res.status, 401);
  assert.equal(store.getAccount(account.id).funnel, 'win_back', 'account must be untouched when the signature is invalid');
});

test('A non-invitee.created event is acknowledged and ignored, not treated as a booking', async () => {
  const rawBody = JSON.stringify({ event: 'invitee.canceled', payload: {} });
  const res = await fetch(`${server.baseUrl}/api/webhooks/calendly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': sign(rawBody) },
    body: rawBody,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ignored, true);
});

test('A booking that cannot be matched to an account is acknowledged (so Calendly stops retrying) but changes nothing', async () => {
  const rawBody = JSON.stringify({ event: 'invitee.created', payload: { tracking: { utm_content: 'no-such-account' } } });
  const res = await fetch(`${server.baseUrl}/api/webhooks/calendly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': sign(rawBody) },
    body: rawBody,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ignored, true);
});

// ---------- Codex review fixes ----------

test('Codex fix: rebooking via Calendly closes an open proposal, so it is not drafted again on the next tick', async () => {
  const account = seedAccount({
    id: 'acct_calendly_proposal',
    funnel: 'proposal_follow_up',
    stage: 'check_in',
    proposal: { sentDate: addDays(todayStr(), -5), eventDate: addDays(todayStr(), 60), outcome: null },
  });
  const rawBody = JSON.stringify({ event: 'invitee.created', payload: { uri: 'https://api.calendly.com/scheduled_events/evt1/invitees/inv1', tracking: { utm_content: account.id } } });

  const res = await fetch(`${server.baseUrl}/api/webhooks/calendly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': sign(rawBody) },
    body: rawBody,
  });
  assert.equal(res.status, 200);

  const updated = store.getAccount(account.id);
  assert.ok(updated.proposal.outcome, 'the proposal must be closed, not left open, once the account has rebooked');
  assert.notEqual(updated.proposal.outcome, null);

  const engine = require('../src/engine');
  engine.runEngineTick();
  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  assert.equal(touches.length, 0, 'a rebooked account must not get another Proposal Follow-Up touch drafted');
});

test('Codex fix: a duplicate webhook delivery of the same booking is ignored, not re-processed', async () => {
  const account = seedAccount({ id: 'acct_calendly_dup', funnel: 'win_back', stage: 'soft_ask' });
  const rawBody = JSON.stringify({ event: 'invitee.created', payload: { uri: 'https://api.calendly.com/scheduled_events/evt2/invitees/inv2', tracking: { utm_content: account.id } } });
  const headers = { 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': sign(rawBody) };

  const first = await fetch(`${server.baseUrl}/api/webhooks/calendly`, { method: 'POST', headers, body: rawBody });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).rebooked, true);

  const purchaseCountAfterFirst = store.getAccount(account.id).purchaseCount;
  const rebookedAtCountAfterFirst = store.getAccount(account.id).rebookedAt.length;

  // Same signature works because it's the literal same rawBody+timestamp —
  // a real retry from Calendly would resend the identical payload/signature.
  const second = await fetch(`${server.baseUrl}/api/webhooks/calendly`, { method: 'POST', headers, body: rawBody });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.ignored, true);
  assert.match(secondBody.reason, /duplicate/);

  const finalAccount = store.getAccount(account.id);
  assert.equal(finalAccount.purchaseCount, purchaseCountAfterFirst, 'a replayed delivery must not double-count the purchase');
  assert.equal(finalAccount.rebookedAt.length, rebookedAtCountAfterFirst, 'a replayed delivery must not append a second rebooking record');
});
