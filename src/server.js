const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const engine = require('./engine');
const dashboard = require('./dashboard');
const access = require('./access');
const guardrails = require('./guardrails');
const gmail = require('./gmail');
const calendly = require('./calendly');
const reviews = require('./reviews');
const { todayStr } = require('./dates');

const app = express();
const PORT = process.env.PORT || 3000;

// `verify` stashes the exact raw request bytes on req.rawBody — needed
// only by the Calendly webhook route below, which must HMAC-verify the
// UNPARSED body (Calendly signs the raw bytes, not the re-serialized JSON,
// which can differ in whitespace/key order). Cheap enough to do for every
// request rather than special-casing one route's body parser.
app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Sync (Make.com → this app; mirrors Salesforce, read-only) ----------
// Point the Make.com scenario's nightly + event-triggered sync at this
// endpoint. It only ever upserts the "source" fields (see store.js
// SOURCE_FIELDS) — local funnel/stage/opt-out state is never overwritten
// by a re-sync, so Salesforce stays read-only from this app's perspective.
//
// Architecture v0.1 §3.2 flagged this endpoint as unauthenticated — that's
// fixed here. Set SYNC_TOKEN in the environment and configure Make.com's
// HTTP module to send it as X-Sync-Token. If SYNC_TOKEN isn't set, the
// check is skipped (local dev only) and a warning prints once at startup.

const SYNC_TOKEN = process.env.SYNC_TOKEN || null;
if (!SYNC_TOKEN) {
  console.warn('[winback] SYNC_TOKEN is not set — /api/sync/accounts is UNAUTHENTICATED. Do not point this at real data until it is.');
}

function requireSyncToken(req, res, next) {
  if (!SYNC_TOKEN) return next(); // local dev only — see warning above
  if (req.get('X-Sync-Token') !== SYNC_TOKEN) {
    return res.status(401).json({ error: 'Missing or invalid X-Sync-Token' });
  }
  next();
}

// /api/engine/run has two legitimate kinds of caller: Make.com, calling it
// back-to-back with the sync (Architecture v0.1 §3.3) — authenticated the
// same way as the sync itself — and Shawn/Ira clicking "Run Cohort Engine"
// on the dashboard, authenticated as an admin user. Either is accepted;
// Audrey/Nick (viewer role) are not, matching the dashboard access rule.
function requireSyncTokenOrAdmin(req, res, next) {
  if (SYNC_TOKEN && req.get('X-Sync-Token') === SYNC_TOKEN) return next();
  return access.requireRole('admin')(req, res, next);
}

app.post('/api/sync/accounts', requireSyncToken, (req, res) => {
  const records = Array.isArray(req.body) ? req.body : req.body?.accounts;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Body must be an array of accounts, or { accounts: [...] }.' });
  }

  let result;
  try {
    result = store.syncAccounts(records);
  } catch (err) {
    store.logSyncRun({ errorMessage: err.message });
    return res.status(400).json({ error: err.message });
  }

  store.logSyncRun({ createdCount: result.created, updatedCount: result.updated, skipped: result.skipped });
  res.status(201).json(result);
});

// Reviewable without opening Make.com — see the runbook.
app.get('/api/sync/runs', access.requireUser, (req, res) => {
  res.json(store.listSyncRuns(Number(req.query.limit) || 50));
});

// ---------- Engine ----------
// Call this on the same cadence as the Make.com sync (nightly + event-triggered).
// It never sends anything — it only drafts touches into the owner review queue.

app.post('/api/engine/run', requireSyncTokenOrAdmin, (req, res) => {
  try {
    const result = engine.runEngineTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reviewable without opening Make.com — see the runbook.
app.get('/api/engine/runs', access.requireUser, (req, res) => {
  res.json(store.listEngineRuns(Number(req.query.limit) || 50));
});

// "Log the full prompt and output for every draft, for traceability."
// One row per generation ATTEMPT — including guardrail-blocked ones, not
// just successfully queued touches. Filter to valid=false to see exactly
// what the drafting engine has refused to queue, and why.
app.get('/api/drafts/generations', access.requireUser, (req, res) => {
  const filter = { limit: Number(req.query.limit) || 100 };
  if (req.query.accountId) filter.accountId = req.query.accountId;
  if (req.query.valid !== undefined) filter.valid = req.query.valid === 'true';
  res.json(store.listDraftGenerations(filter));
});

// ---------- Accounts ----------

app.get('/api/accounts', (req, res) => {
  res.json(store.listAccounts());
});

app.get('/api/accounts/:id', (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const touches = store.listTouches().filter((t) => t.accountId === account.id);
  res.json({ ...account, touches });
});

// Compliance-critical: this is the ONE function that changes optedOut, in
// either direction — see store.setOptOut. "immediately and permanently
// suppresses... until someone manually clears it" (Prompt 8 Item 5) means
// there are exactly two doors: this route (or the public one below) to
// suppress, and the clear-optout route further down to reverse it. Nothing
// else touches this field.
app.post('/api/accounts/:id/opt-out', (req, res) => {
  const account = store.setOptOut(req.params.id, true);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  store.logActivity('opted_out', account.id, `${account.name} opted out of automated touches`);
  res.json(account);
});

// Public-friendly link recipients click from the opt-out footer in every automated email.
app.get('/api/unsubscribe/:id', (req, res) => {
  const account = store.setOptOut(req.params.id, true);
  if (!account) return res.status(404).send('Account not found.');
  store.logActivity('opted_out', account.id, `${account.name} opted out of automated touches`);
  res.set('Content-Type', 'text/html');
  res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
    <h2>You're unsubscribed</h2><p>${account.name} won't receive further automated outreach.</p></body></html>`);
});

// Manually clears an opt-out — the only other door that touches optedOut
// (see store.setOptOut). Admin-only: reversing a compliance suppression is
// a deliberate decision, not a routine owner action.
app.post('/api/accounts/:id/clear-optout', access.requireRole('admin'), (req, res) => {
  const account = store.setOptOut(req.params.id, false);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  store.logActivity('optout_cleared', account.id, `${account.name}'s opt-out was manually cleared by ${req.user.name}`);
  res.json(account);
});

app.post('/api/accounts/:id/rebook', (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const amount = Number(req.body?.amount) || 0;
  const updated = store.rebookAccount(account.id, { amount, fromFunnel: account.funnel, source: 'manual' });
  res.json(updated);
});

app.post('/api/accounts/:id/proposal', (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { sentDate, eventDate } = req.body || {};
  const updated = store.updateAccount(account.id, {
    proposal: { sentDate: sentDate || todayStr(), eventDate: eventDate || '', outcome: null },
  });
  store.logActivity('proposal_sent', account.id, `Proposal logged for ${account.name}`);
  res.json(updated);
});

app.post('/api/accounts/:id/proposal/outcome', (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account || !account.proposal) return res.status(404).json({ error: 'Account or proposal not found' });
  const { outcome, amount, lostReason } = req.body || {};
  // Manually settable outcomes only — expired_no_response is engine-set
  // (engine.js) when the event date passes with no human decision, and
  // should never be something a client-side call can claim happened.
  if (!['full_service', 'diy', 'lost'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be full_service, diy, or lost' });
  }
  if (outcome === 'lost' && !lostReason) {
    return res.status(400).json({ error: 'lostReason is required when recording a Lost outcome (Metrics Spec §6)' });
  }
  const converted = outcome === 'full_service' || outcome === 'diy';
  const dealAmount = Number(amount) || 0;

  const updated = store.updateAccount(account.id, {
    proposal: { ...account.proposal, outcome, amount: converted ? dealAmount : undefined, lostReason: outcome === 'lost' ? lostReason : undefined },
    funnel: converted ? 'none' : 'nurture',
    stage: converted ? null : 'nurture',
  });

  if (converted) {
    // Metrics Spec gap #5-6: this is the amount capture that was missing
    // entirely — without it, Proposal Follow-Up revenue was invisible to
    // Rebooked/Recovered Revenue, which only ever summed Win-Back rebooks.
    store.recordPurchase({ accountId: account.id, date: todayStr(), amount: dealAmount, source: 'proposal_follow_up' });
  }

  store.logActivity('proposal_outcome', account.id, `${account.name} proposal outcome: ${outcome}${dealAmount ? ` ($${dealAmount})` : ''}`);
  res.json(updated);
});

// ---------- Owner review queue ----------

app.get('/api/owners', (req, res) => {
  res.json(store.listOwners());
});

app.patch('/api/owners/:id', (req, res) => {
  const owner = store.updateOwner(req.params.id, req.body || {});
  if (!owner) return res.status(404).json({ error: 'Owner not found' });
  res.json(owner);
});

// Per-owner queue (Prompt 8 Item 1): a viewer sees only their own queue by
// default; ?asOwner=&backupReason= is the one documented, logged way in —
// see access.resolveQueueScope for the full rule.
app.get('/api/touches', access.requireUser, (req, res) => {
  const scope = access.resolveQueueScope(req.user, req.query, store);
  if (scope.error) return res.status(403).json({ error: scope.error });
  if (scope.isBackup) {
    store.logActivity('backup_queue_access', null, `${req.user.name} viewed ${scope.ownerId}'s queue for backup coverage: "${scope.reason}"`);
  }

  let touches = store.listTouches();
  if (scope.ownerId) touches = touches.filter((t) => t.ownerId === scope.ownerId);
  if (req.query.status) touches = touches.filter((t) => t.status === req.query.status);

  const accountsById = new Map(store.listAccounts().map((a) => [a.id, a]));
  touches = touches.map((t) => ({ ...t, account: accountsById.get(t.accountId) || null }));
  res.json(touches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
});

const TOUCH_STATUSES = ['pending_review', 'sent', 'replied', 'out_of_office', 'skipped'];

// Owner edits the draft, then marks it sent (after sending from their own
// inbox), replied, out of office, or skipped. Nothing here sends email on
// the owner's behalf.
//
// out_of_office is deliberately a separate status from replied (Metrics
// Spec §3): an auto-responder is not a reply, and folding it into
// "replied" would both inflate the reply-rate metric and incorrectly
// trigger the stand-down gate on the next stage.
app.patch('/api/touches/:id', (req, res) => {
  const touch = store.getTouch(req.params.id);
  if (!touch) return res.status(404).json({ error: 'Touch not found' });

  if (req.body?.status !== undefined && !TOUCH_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of: ${TOUCH_STATUSES.join(', ')}` });
  }

  const patch = {};
  if (req.body?.subject !== undefined) patch.subject = req.body.subject;
  if (req.body?.body !== undefined) patch.body = req.body.body;
  if (req.body?.status !== undefined) {
    patch.status = req.body.status;
    if (req.body.status === 'sent') patch.sentAt = new Date().toISOString();
    if (req.body.status === 'replied' || req.body.status === 'out_of_office') {
      patch.repliedAt = new Date().toISOString();
      patch.replyMarkedBy = req.body.markedBy || touch.ownerId; // data-quality audit trail, Metrics Spec §3
    }
  }

  const updated = store.updateTouch(touch.id, patch);

  if (patch.status === 'sent') {
    store.updateAccount(touch.accountId, { lastTouchDate: todayStr() });
    const account = store.getAccount(touch.accountId);
    store.logActivity('touch_sent', touch.accountId, `${account ? account.name : touch.accountId}: ${touch.subject} sent`);
  }
  if (patch.status === 'replied') {
    const account = store.getAccount(touch.accountId);
    store.logActivity('touch_replied', touch.accountId, `${account ? account.name : touch.accountId} replied`);
  }
  if (patch.status === 'out_of_office') {
    const account = store.getAccount(touch.accountId);
    store.logActivity('touch_out_of_office', touch.accountId, `${account ? account.name : touch.accountId}: auto-reply/OOO, not counted as a reply`);
  }

  res.json(updated);
});

// Flag a bad draft (Prompt 10 Item 3) — a lightweight way for Audrey or
// Nick to report a specific draft's problem with a reason, distinct from
// just fixing it silently in the editor. Feeds src/reviews.js's monthly
// rollup, which is how this becomes actual future prompt-tuning input for
// the drafting engine (Prompt 6) instead of feedback that only lives in
// someone's memory until the next time it comes up in conversation.
app.post('/api/touches/:id/flag', access.requireUser, (req, res) => {
  const touch = store.getTouch(req.params.id);
  if (!touch) return res.status(404).json({ error: 'Touch not found' });

  const { category, reason } = req.body || {};
  if (!store.DRAFT_FEEDBACK_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${store.DRAFT_FEEDBACK_CATEGORIES.join(', ')}` });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'reason is required — a category alone is not enough to act on later.' });
  }

  const entry = store.logDraftFeedback({ touchId: touch.id, accountId: touch.accountId, ownerId: touch.ownerId, flaggedBy: req.user.id, category, reason: String(reason).trim() });
  store.logActivity('draft_flagged', touch.accountId, `${req.user.name} flagged a draft (${category}): ${entry.reason}`);
  res.status(201).json(entry);
});

app.get('/api/draft-feedback', access.requireRole('admin'), (req, res) => {
  res.json(store.listDraftFeedback({ category: req.query.category, limit: Number(req.query.limit) || 200 }));
});

// "Approve & Send" (Prompt 8 Items 2-3, 6). This is the ONLY code path
// that actually emails a client — everywhere else in this app only drafts
// or edits. Two things are non-negotiable and both happen here, in this
// order, before anything is sent:
//
//   1. Re-run the required-elements guardrail on the draft's CURRENT
//      content (not the content it was generated with) — an owner's edit
//      could have deleted the opt-out or Calendly link since generation.
//      A failure here is a hard 422 block, not a warning; nothing is sent.
//   2. Confirm the target owner has a connected Gmail account — sending
//      always goes through THAT owner's own OAuth connection, never a
//      shared account, regardless of who clicked the button (see the
//      backup-coverage note below).
app.post('/api/touches/:id/send', access.requireUser, async (req, res) => {
  const touch = store.getTouch(req.params.id);
  if (!touch) return res.status(404).json({ error: 'Touch not found' });
  if (touch.kind === 'call_flag') {
    return res.status(400).json({ error: 'Call/text flags are not sent via email — handle personally, then mark Replied or Skipped.' });
  }
  if (touch.status !== 'pending_review') {
    return res.status(400).json({ error: `Touch is already ${touch.status} — nothing to send.` });
  }

  const owner = store.getOwner(touch.ownerId);
  const account = store.getAccount(touch.accountId);
  if (!owner) return res.status(404).json({ error: 'Owner not found' });
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Who may click Approve & Send on THIS touch: the assigned owner
  // themselves, an admin (oversight), or that owner's documented backup —
  // same rule as viewing the queue (access.resolveQueueScope), reused here
  // rather than re-derived, so "who can see it" and "who can act on it"
  // can never quietly drift apart. The email still goes out through the
  // ASSIGNED owner's Gmail either way — backup coverage means operating
  // the queue on their behalf while they're out, not sending as yourself.
  const scope = access.resolveQueueScope(req.user, { asOwner: touch.ownerId, backupReason: req.body?.backupReason }, store);
  if (scope.error && req.user.role !== 'admin' && req.user.id !== touch.ownerId) {
    return res.status(403).json({ error: scope.error });
  }
  if (scope.isBackup) {
    store.logActivity('backup_send', account.id, `${req.user.name} sent ${owner.name}'s "${touch.subject}" draft for backup coverage: "${scope.reason}"`);
  }

  if (!account.contactEmail) {
    return res.status(400).json({ error: 'Account has no contact email on file — cannot send.' });
  }

  // Hard block #1 — re-validate NOW, on whatever the draft currently says,
  // not what it said when generated (guardrails.js is the same gate the
  // drafting engine itself uses before queuing — see engine.js).
  const currentDraft = { kind: touch.kind, subject: touch.subject, body: touch.body };
  const requiredElementErrors = guardrails.validateRequiredElements(currentDraft, owner);
  if (requiredElementErrors.length > 0) {
    return res.status(422).json({ error: 'Send blocked — required compliance elements missing from the current draft.', details: requiredElementErrors });
  }

  // Hard block #2 — the owner's own Gmail, not a shared/service account.
  if (!owner.gmailTokens || !owner.gmailTokens.refreshToken) {
    return res.status(400).json({ error: `${owner.name} has not connected Gmail yet. Connect it from the Owners tab before sending.` });
  }

  const wasEdited = touch.subject !== touch.originalSubject || touch.body !== touch.originalBody;

  let sendResult;
  try {
    sendResult = await gmail.sendEmail({
      ownerTokens: owner.gmailTokens,
      toEmail: account.contactEmail,
      toName: account.contactName,
      subject: touch.subject,
      body: touch.body,
    });
  } catch (err) {
    return res.status(502).json({ error: `Gmail send failed: ${err.message}` });
  }

  const updated = store.updateTouch(touch.id, {
    status: 'sent',
    sentAt: new Date().toISOString(),
    sentBy: req.user.id,
    wasEditedAtSend: wasEdited,
    gmailMessageId: sendResult.messageId,
  });
  store.updateAccount(account.id, { lastTouchDate: todayStr() });
  store.logActivity(
    'touch_sent',
    account.id,
    `${account.name}: "${touch.subject}" sent via ${owner.name}'s Gmail${wasEdited ? ' (edited before send)' : ''}${req.user.id !== touch.ownerId ? ` — sent by ${req.user.name}` : ''}`
  );
  store.logSend({ touchId: touch.id, accountId: account.id, ownerId: touch.ownerId, sentBy: req.user.id, wasEdited, gmailMessageId: sendResult.messageId });

  res.json(updated);
});

// Full send audit — "log every send... back to the data store for the
// dashboard" (Prompt 8 Item 6). Distinct from /api/drafts/generations
// (the drafting engine's attempt log) and the per-account activity feed —
// this is one row per actual send, who/when/edited-or-not.
app.get('/api/sends', access.requireUser, (req, res) => {
  res.json(store.listSends(Number(req.query.limit) || 100));
});

// ---------- Gmail OAuth (per-owner, never a shared account) ----------
// Prompt 8 Item 3. Each owner connects their OWN Gmail from the Owners
// tab. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI
// to be provisioned (a Google Cloud OAuth client, Gmail API enabled) — see
// src/gmail.js header. Until then this returns a clear 501, not a silent
// failure.

if (!gmail.credentialsConfigured()) {
  console.warn('[winback] GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI are not set — Gmail connect/send is disabled until they are provisioned.');
}

app.get('/api/owners/:id/gmail/connect', access.requireUser, (req, res) => {
  if (!gmail.credentialsConfigured()) {
    return res.status(501).json({ error: 'Gmail OAuth is not configured on this deployment yet — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI.' });
  }
  const owner = store.getOwner(req.params.id);
  if (!owner) return res.status(404).json({ error: 'Owner not found' });
  res.json({ authUrl: gmail.getAuthUrl(owner.id) });
});

app.get('/api/gmail/callback', async (req, res) => {
  const { code, state: ownerId, error } = req.query;
  if (error) return res.status(400).send(`Gmail connection cancelled or failed: ${error}`);
  if (!code || !ownerId) return res.status(400).send('Missing code or state on Gmail OAuth callback.');

  try {
    const tokens = await gmail.exchangeCodeForTokens(code);
    const owner = store.updateOwner(ownerId, {
      gmailTokens: { refreshToken: tokens.refreshToken, email: tokens.email, connectedAt: new Date().toISOString() },
    });
    if (!owner) return res.status(404).send('Owner not found.');
    store.logActivity('gmail_connected', null, `${owner.name} connected Gmail (${tokens.email})`);
    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
      <h2>Gmail connected</h2><p>${owner.name} is now connected as ${tokens.email}. You can close this tab and return to the dashboard.</p></body></html>`);
  } catch (err) {
    res.status(500).send(`Gmail connection failed: ${err.message}`);
  }
});

app.post('/api/owners/:id/gmail/disconnect', access.requireUser, (req, res) => {
  const owner = store.updateOwner(req.params.id, { gmailTokens: null });
  if (!owner) return res.status(404).json({ error: 'Owner not found' });
  store.logActivity('gmail_disconnected', null, `${owner.name} disconnected Gmail`);
  res.json(owner);
});

// ---------- Calendly webhook (Prompt 8 Item 4) ----------
// A booking on an owner's Calendly link auto-marks the account "Rebooked"
// — no manual step. See src/calendly.js for signature verification and
// how the booking maps back to an account (the ?utm_content=<accountId>
// tracking param src/interpolate.js appends to every Calendly link).
//
// Requires CALENDLY_WEBHOOK_SIGNING_KEY to be provisioned (from Calendly's
// webhook subscription API) — without it, signature verification is
// skipped and a startup warning prints. Register the subscription once,
// pointed at POST <APP_BASE_URL>/api/webhooks/calendly, subscribed to the
// invitee.created event.

const CALENDLY_WEBHOOK_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY || null;
if (!CALENDLY_WEBHOOK_SIGNING_KEY) {
  console.warn('[winback] CALENDLY_WEBHOOK_SIGNING_KEY is not set — /api/webhooks/calendly will accept UNVERIFIED requests. Do not point a real Calendly subscription at this until it is set.');
}

app.post('/api/webhooks/calendly', (req, res) => {
  if (CALENDLY_WEBHOOK_SIGNING_KEY) {
    const signatureHeader = req.get('Calendly-Webhook-Signature');
    if (!calendly.verifySignature(req.rawBody, signatureHeader, CALENDLY_WEBHOOK_SIGNING_KEY)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  const event = req.body;
  if (!calendly.isInviteeCreated(event)) {
    return res.status(200).json({ ignored: true, reason: 'not an invitee.created event' });
  }

  const accountId = calendly.extractAccountId(event);
  if (!accountId) {
    store.logActivity('calendly_booking_unmatched', null, 'Calendly booking received with no utm_content account tracking — could not auto-match to an account.');
    return res.status(200).json({ ignored: true, reason: 'no accountId in tracking.utm_content' });
  }

  const account = store.getAccount(accountId);
  if (!account) {
    store.logActivity('calendly_booking_unmatched', null, `Calendly booking tracked to unknown account id "${accountId}".`);
    return res.status(200).json({ ignored: true, reason: 'accountId not found' });
  }

  const updated = store.rebookAccount(accountId, { fromFunnel: account.funnel, source: 'calendly_webhook' });
  res.status(200).json({ rebooked: true, accountId: updated.id });
});

// ---------- Pilot checkpoint mode (Prompt 9 Item 3) ----------
// While on, the engine proposes each stage transition as a pending
// checkpoint instead of drafting it automatically — "nothing auto-
// progresses without a human check" during the observation window. Off is
// the default and matches every prior prompt's already-tested behavior.

app.get('/api/settings', access.requireUser, (req, res) => {
  res.json({ checkpointMode: store.getSetting('checkpointMode', false), rolloutDate: store.getSetting('rolloutDate', null) });
});

app.post('/api/settings/checkpoint-mode', access.requireRole('admin'), (req, res) => {
  const enabled = !!req.body?.enabled;
  store.setSetting('checkpointMode', enabled);
  store.logActivity('checkpoint_mode_changed', null, `Checkpoint mode turned ${enabled ? 'ON' : 'OFF'} by ${req.user.name}`);
  res.json({ checkpointMode: enabled });
});

app.get('/api/checkpoints', access.requireUser, (req, res) => {
  const checkpoints = store.listCheckpoints({ status: req.query.status, limit: Number(req.query.limit) || 200 });
  const accountsById = new Map(store.listAccounts().map((a) => [a.id, a]));
  res.json(checkpoints.map((c) => ({ ...c, account: accountsById.get(c.accountId) || null })));
});

app.post('/api/checkpoints/:id/approve', access.requireRole('admin'), (req, res) => {
  try {
    const result = engine.approveCheckpoint(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/checkpoints/:id/reject', access.requireRole('admin'), (req, res) => {
  try {
    engine.rejectCheckpoint(req.params.id, req.user.id, req.body?.reason);
    res.json({ rejected: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Ongoing operating cadence (Prompt 10) ----------
// Marking rollout is the one deliberate switch that starts the 30-day
// clock the monthly review cadence is built around (see the scheduled
// Routine set up alongside this code, and the operating cadence doc for
// the full process this supports).

app.post('/api/settings/mark-rollout', access.requireRole('admin'), (req, res) => {
  const rolloutDate = store.setSetting('rolloutDate', todayStr());
  store.logActivity('rollout_marked', null, `Full rollout marked by ${req.user.name} — the monthly review cadence begins 30 days from today.`);
  res.json({ rolloutDate });
});

// History of generated reviews — what src/reviews.js compares each new
// review against to detect a metric missing target two months running.
app.get('/api/reviews/monthly', access.requireUser, (req, res) => {
  res.json(store.listMonthlyReviews(Number(req.query.limit) || 24));
});

app.post('/api/reviews/monthly/generate', access.requireRole('admin'), (req, res) => {
  res.status(201).json(reviews.generateMonthlyReview());
});

// ---------- Dev convenience ----------
// Loads data/sample-accounts.json — a stand-in for the first Make.com sync,
// so the pilot can be demoed without a live Salesforce connection.

app.post('/api/dev/seed', access.requireRole('admin'), (req, res) => {
  const samplePath = path.join(__dirname, '..', 'data', 'sample-accounts.json');
  const records = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const result = store.syncAccounts(records);
  res.status(201).json(result);
});

// ---------- Dashboard access ----------
// See src/access.js for what this is (and isn't — no real auth yet).

app.get('/api/users', (req, res) => {
  res.json(store.listUsers());
});

// ---------- Dashboard ----------
// Read access: any recognized user (Audrey/Nick included — "read-only for
// Audrey/Nick" means they can view this, just not trigger the admin
// actions below). Unrecognized/missing X-User-Id is rejected, not treated
// as public.

app.get('/api/dashboard', access.requireUser, (req, res) => {
  res.json(dashboard.getDashboard());
});

// Manual for now — intended to be called on a schedule (Make.com or
// equivalent) so Repeat-Purchase Rate YoY has stored history to compare
// against once enough time has passed. See Metrics Spec gap #2.
// Admin-only — "full access for Shawn and Ira" on dashboard data-management actions.
app.post('/api/dev/snapshot-metrics', access.requireRole('admin'), (req, res) => {
  const d = dashboard.getDashboard();
  const periodEnd = todayStr();
  const periodStart = todayStr();
  store.recordMetricsSnapshot({ periodStart, periodEnd, metricName: 'repeatPurchaseRateYoY', value: d.repeatPurchaseRateYoY });
  store.recordMetricsSnapshot({ periodStart, periodEnd, metricName: 'replyRateLast30', value: d.replyRateLast30 });
  store.recordMetricsSnapshot({ periodStart, periodEnd, metricName: 'recoveredRevenueQTD', value: d.recoveredRevenueQTD.total });
  res.status(201).json({ snapshotted: 3, at: new Date().toISOString() });
});

// Guarded so `require('./server')` (tests hitting real HTTP routes against
// an ephemeral port) doesn't also bind :3000 — only actually running this
// file (`node src/server.js` / `npm start`) starts the real listener.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Impact4Good Win-Back & Proposal Follow-Up system running at http://localhost:${PORT}`);
  });
}

module.exports = app;
