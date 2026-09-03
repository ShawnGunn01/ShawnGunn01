const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.WINBACK_DATA_DIR || path.join(__dirname, '..', 'data');

const FILES = {
  accounts: path.join(DATA_DIR, 'accounts.json'),
  touches: path.join(DATA_DIR, 'touches.json'),
  owners: path.join(DATA_DIR, 'owners.json'),
  activity: path.join(DATA_DIR, 'activity.json'),
  purchases: path.join(DATA_DIR, 'purchases.json'),
  syncRuns: path.join(DATA_DIR, 'sync_runs.json'),
  engineRuns: path.join(DATA_DIR, 'engine_runs.json'),
  metricsSnapshots: path.join(DATA_DIR, 'metrics_snapshots.json'),
};

// Fields a synced record must carry a real (non-empty) value for. Anything
// missing one of these gets routed to the sync's `skipped` list instead of
// silently accepted with a null — see Architecture v0.1 §4.
const REQUIRED_SYNC_FIELDS = ['id', 'name', 'ownerId', 'lastPurchaseDate'];

const DEFAULT_OWNERS = [
  { id: 'audrey', name: 'Audrey', email: '', calendlyLink: '', backupFor: 'nick' },
  { id: 'nick', name: 'Nick', email: '', calendlyLink: '', backupFor: 'audrey' },
];

function ensureFile(file, seed) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(seed, null, 2));
  }
}

function readJson(file, seed) {
  ensureFile(file, seed);
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? JSON.parse(raw) : seed;
}

function writeJson(file, data) {
  ensureFile(file, data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

// ---------- Accounts ----------
// Accounts mirror Salesforce (via the Make.com sync webhook) and are the
// system of record for cohort/timing decisions. Sync payloads only ever
// touch the "source fields" below — never the local funnel/stage/opt-out
// state — so a re-sync can't clobber in-flight sequence progress.

const SOURCE_FIELDS = [
  'name',
  'contactName',
  'contactEmail',
  'ownerId',
  'lastPurchaseDate',
  'purchaseCount',
  'eventBookedDate',
  'eventAnniversaryDate',
];

function listAccounts() {
  return readJson(FILES.accounts, []);
}

function saveAccounts(accounts) {
  writeJson(FILES.accounts, accounts);
}

function getAccount(id) {
  return listAccounts().find((a) => a.id === id) || null;
}

function updateAccount(id, patch) {
  const accounts = listAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) return null;
  Object.assign(account, patch);
  saveAccounts(accounts);
  return account;
}

function validateSyncRecord(rec) {
  for (const field of REQUIRED_SYNC_FIELDS) {
    if (rec[field] === undefined || rec[field] === null || rec[field] === '') {
      return `missing required field: ${field}`;
    }
  }
  if (Number.isNaN(Date.parse(rec.lastPurchaseDate))) {
    return `lastPurchaseDate is not a parseable date: ${JSON.stringify(rec.lastPurchaseDate)}`;
  }
  return null;
}

// Upsert accounts synced from Salesforce (via Make.com). Never overwrites
// local sequence state (funnel/stage/optedOut/proposal outcome/etc).
// One bad record in a batch never blocks the rest — it's routed to
// `skipped` with a reason instead of silently accepted or failing the
// whole call. See Architecture v0.1 §4 (partial-batch failure) and
// Scenario 4 (a Salesforce field arriving null instead of erroring).
function syncAccounts(records) {
  const accounts = listAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const rec of records) {
    const reason = validateSyncRecord(rec);
    if (reason) {
      skipped.push({ id: rec && rec.id, reason });
      continue;
    }

    const existing = byId.get(rec.id);
    if (existing) {
      for (const field of SOURCE_FIELDS) {
        if (rec[field] !== undefined) existing[field] = rec[field];
      }
      if (rec.proposal) existing.proposal = { ...existing.proposal, ...rec.proposal };
      existing.syncedAt = now;
      updated += 1;
    } else {
      const account = {
        id: rec.id,
        name: rec.name || 'Unknown Account',
        contactName: rec.contactName || '',
        contactEmail: rec.contactEmail || '',
        ownerId: rec.ownerId || 'audrey',
        lastPurchaseDate: rec.lastPurchaseDate || '',
        purchaseCount: Number(rec.purchaseCount) || 1,
        eventBookedDate: rec.eventBookedDate || '',
        eventAnniversaryDate: rec.eventAnniversaryDate || '',
        lastTouchDate: rec.lastTouchDate || rec.lastPurchaseDate || '',
        proposal: rec.proposal || null, // { sentDate, eventDate, outcome, amount, lostReason }
        funnel: 'none', // none | win_back | proposal_follow_up | nurture
        stage: null,
        stageEnteredDate: null,
        optedOut: false,
        rebookedRevenue: 0,
        rebookedAt: [],
        createdAt: now,
        syncedAt: now,
      };
      byId.set(account.id, account);
      created += 1;
    }
  }

  saveAccounts([...byId.values()]);
  return { created, updated, skipped };
}

// Hours since the freshest account sync. Drives the dashboard's "sync may
// be stale" banner (Architecture v0.1 §4) — the cheapest, most direct
// answer to "what happens if Make.com sync fails silently."
function hoursSinceLastSync() {
  const accounts = listAccounts();
  if (accounts.length === 0) return null;
  const latest = accounts.reduce((max, a) => {
    const t = a.syncedAt ? new Date(a.syncedAt).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  if (latest === 0) return null;
  return (Date.now() - latest) / (1000 * 60 * 60);
}

// ---------- Purchases (event log — see Metrics Spec gap #1) ----------
// A running purchaseCount + single lastPurchaseDate can't answer "how many
// of these fell in the last 365 days," which real Repeat-Purchase Rate YoY
// needs. This log is the fix: one dated row per purchase, sourced either
// from a Salesforce sync that includes purchase history, or recorded
// directly by this system when it produces a rebook or proposal conversion.

function listPurchases(accountId) {
  const purchases = readJson(FILES.purchases, []);
  return accountId ? purchases.filter((p) => p.accountId === accountId) : purchases;
}

function recordPurchase({ accountId, date, amount, source }) {
  const purchases = readJson(FILES.purchases, []);
  const entry = { id: genId('purch'), accountId, date, amount: Number(amount) || 0, source, recordedAt: new Date().toISOString() };
  purchases.push(entry);
  writeJson(FILES.purchases, purchases);
  return entry;
}

// ---------- Metrics snapshots (see Metrics Spec gap #2) ----------
// Intended to be written on a schedule (Make.com or equivalent) so a YoY
// comparison is a lookup against stored history rather than a full
// recompute every time. Manual for now — see server.js POST /api/dev/snapshot-metrics.

function recordMetricsSnapshot({ periodStart, periodEnd, metricName, value }) {
  const snapshots = readJson(FILES.metricsSnapshots, []);
  snapshots.push({ id: genId('snap'), periodStart, periodEnd, metricName, value, computedAt: new Date().toISOString() });
  writeJson(FILES.metricsSnapshots, snapshots);
}

function listMetricsSnapshots(metricName) {
  const snapshots = readJson(FILES.metricsSnapshots, []);
  return metricName ? snapshots.filter((s) => s.metricName === metricName) : snapshots;
}

// ---------- Touches (AI-drafted outreach, owner reviews & sends) ----------

function listTouches() {
  return readJson(FILES.touches, []);
}

function saveTouches(touches) {
  writeJson(FILES.touches, touches);
}

function getTouch(id) {
  return listTouches().find((t) => t.id === id) || null;
}

function createTouch({ accountId, funnel, stage, subject, body, ownerId, kind, draftSource }) {
  const touches = listTouches();
  const touch = {
    id: genId('touch'),
    accountId,
    funnel,
    stage,
    kind: kind || 'email', // 'email' | 'call_flag'
    subject,
    body,
    ownerId,
    draftSource: draftSource || 'template', // 'template' | 'ai' | 'template_fallback'
    status: 'pending_review', // pending_review | sent | replied | out_of_office | skipped
    createdAt: new Date().toISOString(),
    sentAt: null,
    repliedAt: null,
    replyMarkedBy: null, // ownerId who marked replied/out_of_office — data-quality audit trail
  };
  touches.push(touch);
  saveTouches(touches);
  return touch;
}

function updateTouch(id, patch) {
  const touches = listTouches();
  const touch = touches.find((t) => t.id === id);
  if (!touch) return null;
  Object.assign(touch, patch);
  saveTouches(touches);
  return touch;
}

// Most recent touch for an account at a given funnel+stage (used to gate
// "no reply" advancement, e.g. Incentive only fires if Soft Ask wasn't replied to).
function lastTouchForStage(accountId, funnel, stage) {
  const touches = listTouches().filter((t) => t.accountId === accountId && t.funnel === funnel && t.stage === stage);
  return touches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function hasTouchForStage(accountId, funnel, stage) {
  return listTouches().some((t) => t.accountId === accountId && t.funnel === funnel && t.stage === stage);
}

// ---------- Owners ----------

function listOwners() {
  return readJson(FILES.owners, DEFAULT_OWNERS);
}

function updateOwner(id, patch) {
  const owners = listOwners();
  const owner = owners.find((o) => o.id === id);
  if (!owner) return null;
  Object.assign(owner, patch);
  writeJson(FILES.owners, owners);
  return owner;
}

// ---------- Activity log ----------

function logActivity(type, accountId, summary, extra = {}) {
  const activity = readJson(FILES.activity, []);
  activity.push({ id: genId('act'), type, accountId, summary, at: new Date().toISOString(), ...extra });
  writeJson(FILES.activity, activity);
}

function listActivity(limit = 50) {
  const activity = readJson(FILES.activity, []);
  return activity.slice(-limit).reverse();
}

// ---------- Sync & engine run log ----------
// "Log every sync run and every cohort recalculation somewhere reviewable
// without opening Make.com." These are separate from the activity log
// (which is per-account, human-readable) — these are per-RUN, machine
// records: one row per sync call, one row per engine tick, with outcome
// and errors, so sync/engine health is checkable from this system alone.

function logSyncRun({ createdCount, updatedCount, skipped, errorMessage }) {
  const runs = readJson(FILES.syncRuns, []);
  const run = {
    id: genId('syncrun'),
    at: new Date().toISOString(),
    createdCount: createdCount || 0,
    updatedCount: updatedCount || 0,
    skippedCount: (skipped || []).length,
    skipped: skipped || [],
    status: errorMessage ? 'error' : (skipped || []).length > 0 ? 'partial' : 'ok',
    errorMessage: errorMessage || null,
  };
  runs.push(run);
  writeJson(FILES.syncRuns, runs);
  return run;
}

function listSyncRuns(limit = 50) {
  const runs = readJson(FILES.syncRuns, []);
  return runs.slice(-limit).reverse();
}

function logEngineRun({ touchesCreated, accountsAdvanced, errorMessage, startedAt }) {
  const runs = readJson(FILES.engineRuns, []);
  const run = {
    id: genId('enginerun'),
    at: new Date().toISOString(),
    startedAt: startedAt || null,
    touchesCreated: touchesCreated || 0,
    accountsAdvanced: accountsAdvanced || 0,
    status: errorMessage ? 'error' : 'ok',
    errorMessage: errorMessage || null,
  };
  runs.push(run);
  writeJson(FILES.engineRuns, runs);
  return run;
}

function listEngineRuns(limit = 50) {
  const runs = readJson(FILES.engineRuns, []);
  return runs.slice(-limit).reverse();
}

module.exports = {
  listAccounts,
  saveAccounts,
  getAccount,
  updateAccount,
  syncAccounts,
  hoursSinceLastSync,
  listTouches,
  saveTouches,
  getTouch,
  createTouch,
  updateTouch,
  lastTouchForStage,
  hasTouchForStage,
  listOwners,
  updateOwner,
  logActivity,
  listActivity,
  listPurchases,
  recordPurchase,
  recordMetricsSnapshot,
  listMetricsSnapshots,
  logSyncRun,
  listSyncRuns,
  logEngineRun,
  listEngineRuns,
};
