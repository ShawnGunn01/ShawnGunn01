// Approve & Send — hard-block guardrails, per-owner Gmail, queue scoping,
// logged backup access, and full send logging (Prompt 8 Items 1-3, 6).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-send-test-'));
const tmpDir = process.env.WINBACK_DATA_DIR;

const store = require('../src/store');
const drafts = require('../src/drafts');
const { interpolateDraft } = require('../src/interpolate');
const gmailModule = require('../src/gmail');
const app = require('../src/server');
const { startServer, stopServer } = require('./helpers/http');
const { addDays, todayStr } = require('../src/dates');

store.updateOwner('audrey', {
  calendlyLink: 'https://calendly.com/audrey-impact4good',
  gmailTokens: { refreshToken: 'fake-refresh-audrey', email: 'audrey@impact4good.example', connectedAt: new Date().toISOString() },
});
store.updateOwner('nick', { calendlyLink: 'https://calendly.com/nick-impact4good' }); // deliberately NOT Gmail-connected

const sentCalls = [];
gmailModule.sendEmail = async (params) => {
  sentCalls.push(params);
  return { messageId: `msg_${sentCalls.length}`, threadId: `thread_${sentCalls.length}` };
};

function seedAccountAndTouch(ownerId, overrides = {}) {
  const uid = Math.random().toString(36).slice(2, 8);
  const account = {
    id: `acct_${uid}`,
    name: `Test Org ${uid}`,
    contactName: 'Renee',
    contactEmail: 'renee@example.com',
    ownerId,
    lastPurchaseDate: addDays(todayStr(), -200),
    eventAnniversaryDate: addDays(todayStr(), 38),
    lastTouchDate: addDays(todayStr(), -100),
    ...overrides,
  };
  store.syncAccounts([account]);
  const owner = store.getOwner(ownerId);
  const rawDraft = drafts.draftWinBack('soft_ask', account);
  const finalDraft = interpolateDraft(rawDraft, owner, account.id);
  const touch = store.createTouch({
    accountId: account.id,
    funnel: 'win_back',
    stage: 'soft_ask',
    subject: finalDraft.subject,
    body: finalDraft.body,
    ownerId,
    kind: 'email',
    draftSource: 'template',
  });
  return { account: store.getAccount(account.id), touch };
}

let server;

test.before(async () => {
  server = await startServer(app);
});

test.after(async () => {
  await stopServer(server.listener);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Approve & Send: a clean draft sends via the owner\'s Gmail, marks the touch sent, and logs the send', async () => {
  const { account, touch } = seedAccountAndTouch('audrey');
  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.status, 'sent');
  assert.equal(updated.sentBy, 'audrey');
  assert.equal(updated.wasEditedAtSend, false);
  assert.ok(updated.gmailMessageId);

  assert.equal(sentCalls.at(-1).toEmail, account.contactEmail);
  const sends = store.listSends();
  assert.equal(sends[0].touchId, touch.id);
  assert.equal(sends[0].ownerId, 'audrey');
  assert.equal(sends[0].sentBy, 'audrey');
  assert.equal(sends[0].wasEdited, false);
});

test('Approve & Send: a draft edited to strip the opt-out link is HARD BLOCKED, not just warned, and nothing is sent', async () => {
  const { touch } = seedAccountAndTouch('audrey');
  const strippedBody = touch.body.replace(/\n\n---\nDon't want these emails\?.*$/s, '');
  await fetch(`${server.baseUrl}/api/touches/${touch.id}`, { method: 'PATCH', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ body: strippedBody }) });

  const callsBefore = sentCalls.length;
  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.details.some((e) => e.includes('opt-out')));

  assert.equal(sentCalls.length, callsBefore, 'Gmail send must never be attempted once the guardrail blocks');
  assert.equal(store.getTouch(touch.id).status, 'pending_review', 'blocked send must not change touch status');
});

test('Approve & Send: a draft edited to strip the Calendly link is HARD BLOCKED', async () => {
  const { touch } = seedAccountAndTouch('audrey');
  const strippedBody = touch.body.replace('https://calendly.com/audrey-impact4good', '');
  await fetch(`${server.baseUrl}/api/touches/${touch.id}`, { method: 'PATCH', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ body: strippedBody }) });

  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.details.some((e) => e.includes('Calendly')));
});

test('Approve & Send: blocked when the assigned owner has not connected Gmail', async () => {
  const { touch } = seedAccountAndTouch('nick');
  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'nick', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /has not connected Gmail/);
});

test('Approve & Send: an edited-but-still-compliant draft is flagged wasEditedAtSend', async () => {
  const { touch } = seedAccountAndTouch('audrey');
  const editedSubject = `${touch.subject} (edited)`;
  await fetch(`${server.baseUrl}/api/touches/${touch.id}`, { method: 'PATCH', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: editedSubject }) });

  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: '{}' });
  const updated = await res.json();
  assert.equal(updated.wasEditedAtSend, true);
  assert.equal(store.listSends()[0].wasEdited, true);
});

test('Approve & Send: a call_flag (Escalation) touch cannot be sent via email', async () => {
  const uid = Math.random().toString(36).slice(2, 8);
  const account = { id: `acct_call_${uid}`, name: `Call Org ${uid}`, contactName: 'Elena', ownerId: 'audrey', lastPurchaseDate: addDays(todayStr(), -200) };
  store.syncAccounts([account]);
  const touch = store.createTouch({ accountId: account.id, funnel: 'win_back', stage: 'escalation', subject: '[Personal outreach]', body: 'Call script', ownerId: 'audrey', kind: 'call_flag', draftSource: 'template' });

  const res = await fetch(`${server.baseUrl}/api/touches/${touch.id}/send`, { method: 'POST', headers: { 'X-User-Id': 'audrey', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 400);
});

// ---------- Per-owner queue scoping + logged backup access ----------

test('GET /api/touches: a viewer sees only their own queue by default', async () => {
  const { touch: audreyTouch } = seedAccountAndTouch('audrey');
  const { touch: nickTouch } = seedAccountAndTouch('nick');

  const res = await fetch(`${server.baseUrl}/api/touches?status=pending_review`, { headers: { 'X-User-Id': 'audrey' } });
  const touches = await res.json();
  assert.ok(touches.some((t) => t.id === audreyTouch.id));
  assert.ok(!touches.some((t) => t.id === nickTouch.id), 'Audrey must not see Nick\'s queue by default');
});

test('GET /api/touches: asOwner without backupReason is rejected; a valid backup with a reason is allowed and logged', async () => {
  const { touch: nickTouch } = seedAccountAndTouch('nick');

  const noReason = await fetch(`${server.baseUrl}/api/touches?status=pending_review&asOwner=nick`, { headers: { 'X-User-Id': 'audrey' } });
  assert.equal(noReason.status, 403);

  const activityBefore = store.listActivity(200).filter((a) => a.type === 'backup_queue_access').length;
  const withReason = await fetch(`${server.baseUrl}/api/touches?status=pending_review&asOwner=nick&backupReason=${encodeURIComponent('Nick is out sick')}`, { headers: { 'X-User-Id': 'audrey' } });
  assert.equal(withReason.status, 200);
  const touches = await withReason.json();
  assert.ok(touches.some((t) => t.id === nickTouch.id));

  const activityAfter = store.listActivity(200).filter((a) => a.type === 'backup_queue_access').length;
  assert.equal(activityAfter, activityBefore + 1, 'backup access must be logged, not just gate-checked');
});

test('GET /api/touches: asOwner is rejected when the requester is NOT that target\'s documented backup', async () => {
  // audrey.backupFor = 'nick' (seeded default) — audrey covers Nick's
  // queue, not some unrelated owner's. Asking for a target she has no
  // documented relationship to must be rejected, reason or not.
  const res = await fetch(`${server.baseUrl}/api/touches?status=pending_review&asOwner=someone-audrey-does-not-cover&backupReason=${encodeURIComponent('trying anyway')}`, { headers: { 'X-User-Id': 'audrey' } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /not the designated backup/);
});

test('Admins see every owner\'s queue with no backup flag or logging required', async () => {
  const activityBefore = store.listActivity(200).filter((a) => a.type === 'backup_queue_access').length;
  const res = await fetch(`${server.baseUrl}/api/touches?status=pending_review`, { headers: { 'X-User-Id': 'shawn' } });
  assert.equal(res.status, 200);
  const activityAfter = store.listActivity(200).filter((a) => a.type === 'backup_queue_access').length;
  assert.equal(activityAfter, activityBefore, 'admin visibility is not backup coverage and must not be logged as such');
});
