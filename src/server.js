const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const engine = require('./engine');
const dashboard = require('./dashboard');
const access = require('./access');
const { todayStr } = require('./dates');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
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

app.post('/api/accounts/:id/opt-out', (req, res) => {
  const account = store.updateAccount(req.params.id, { optedOut: true, funnel: 'none', stage: null });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  store.logActivity('opted_out', account.id, `${account.name} opted out of automated touches`);
  res.json(account);
});

// Public-friendly link recipients click from the opt-out footer in every automated email.
app.get('/api/unsubscribe/:id', (req, res) => {
  const account = store.updateAccount(req.params.id, { optedOut: true, funnel: 'none', stage: null });
  if (!account) return res.status(404).send('Account not found.');
  store.logActivity('opted_out', account.id, `${account.name} opted out of automated touches`);
  res.set('Content-Type', 'text/html');
  res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
    <h2>You're unsubscribed</h2><p>${account.name} won't receive further automated outreach.</p></body></html>`);
});

app.post('/api/accounts/:id/rebook', (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const amount = Number(req.body?.amount) || 0;
  const fromFunnel = account.funnel;

  const rebookedAt = [...(account.rebookedAt || []), { at: new Date().toISOString(), amount, fromFunnel, motion: 'win_back' }];
  const updated = store.updateAccount(account.id, {
    funnel: 'none',
    stage: null,
    lastPurchaseDate: todayStr(),
    lastTouchDate: todayStr(),
    purchaseCount: (account.purchaseCount || 0) + 1,
    rebookedRevenue: (account.rebookedRevenue || 0) + amount,
    rebookedAt,
  });
  // Metrics Spec gap #1: a dated purchase row, not just a bumped counter —
  // this is what makes a real trailing-window Repeat-Purchase Rate possible.
  store.recordPurchase({ accountId: account.id, date: todayStr(), amount, source: 'rebook' });
  store.logActivity('rebooked', account.id, `${account.name} rebooked${amount ? ` for $${amount}` : ''}`, { amount });
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

app.get('/api/touches', (req, res) => {
  let touches = store.listTouches();
  if (req.query.ownerId) touches = touches.filter((t) => t.ownerId === req.query.ownerId);
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

app.listen(PORT, () => {
  console.log(`Impact4Good Win-Back & Proposal Follow-Up system running at http://localhost:${PORT}`);
});

module.exports = app;
