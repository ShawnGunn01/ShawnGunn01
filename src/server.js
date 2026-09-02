const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const engine = require('./engine');
const dashboard = require('./dashboard');
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

app.post('/api/sync/accounts', (req, res) => {
  const records = Array.isArray(req.body) ? req.body : req.body?.accounts;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Body must be an array of accounts, or { accounts: [...] }.' });
  }
  const result = store.syncAccounts(records);
  res.status(201).json(result);
});

// ---------- Engine ----------
// Call this on the same cadence as the Make.com sync (nightly + event-triggered).
// It never sends anything — it only drafts touches into the owner review queue.

app.post('/api/engine/run', (req, res) => {
  const result = engine.runEngineTick();
  res.json(result);
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

  const rebookedAt = [...(account.rebookedAt || []), { at: new Date().toISOString(), amount, fromFunnel }];
  const updated = store.updateAccount(account.id, {
    funnel: 'none',
    stage: null,
    lastPurchaseDate: todayStr(),
    lastTouchDate: todayStr(),
    purchaseCount: (account.purchaseCount || 0) + 1,
    rebookedRevenue: (account.rebookedRevenue || 0) + amount,
    rebookedAt,
  });
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
  const { outcome } = req.body || {};
  if (!['full_service', 'diy', 'lost'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be full_service, diy, or lost' });
  }
  const converted = outcome === 'full_service' || outcome === 'diy';
  const updated = store.updateAccount(account.id, {
    proposal: { ...account.proposal, outcome },
    funnel: converted ? 'none' : 'nurture',
    stage: converted ? null : 'nurture',
  });
  store.logActivity('proposal_outcome', account.id, `${account.name} proposal outcome: ${outcome}`);
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

// Owner edits the draft, then marks it sent (after sending from their own
// inbox), replied, or skipped. Nothing here sends email on the owner's behalf.
app.patch('/api/touches/:id', (req, res) => {
  const touch = store.getTouch(req.params.id);
  if (!touch) return res.status(404).json({ error: 'Touch not found' });

  const patch = {};
  if (req.body?.subject !== undefined) patch.subject = req.body.subject;
  if (req.body?.body !== undefined) patch.body = req.body.body;
  if (req.body?.status !== undefined) {
    patch.status = req.body.status;
    if (req.body.status === 'sent') patch.sentAt = new Date().toISOString();
    if (req.body.status === 'replied') patch.repliedAt = new Date().toISOString();
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

  res.json(updated);
});

// ---------- Dev convenience ----------
// Loads data/sample-accounts.json — a stand-in for the first Make.com sync,
// so the pilot can be demoed without a live Salesforce connection.

app.post('/api/dev/seed', (req, res) => {
  const samplePath = path.join(__dirname, '..', 'data', 'sample-accounts.json');
  const records = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const result = store.syncAccounts(records);
  res.status(201).json(result);
});

// ---------- Dashboard ----------

app.get('/api/dashboard', (req, res) => {
  res.json(dashboard.getDashboard());
});

app.listen(PORT, () => {
  console.log(`Impact4Good Win-Back & Proposal Follow-Up system running at http://localhost:${PORT}`);
});

module.exports = app;
