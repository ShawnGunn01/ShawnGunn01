const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.WINBACK_DATA_DIR || path.join(__dirname, '..', 'data');

const FILES = {
  accounts: path.join(DATA_DIR, 'accounts.json'),
  touches: path.join(DATA_DIR, 'touches.json'),
  owners: path.join(DATA_DIR, 'owners.json'),
  activity: path.join(DATA_DIR, 'activity.json'),
};

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

// Upsert accounts synced from Salesforce (via Make.com). Never overwrites
// local sequence state (funnel/stage/optedOut/proposal outcome/etc).
function syncAccounts(records) {
  const accounts = listAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  for (const rec of records) {
    if (!rec.id) continue;
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
        proposal: rec.proposal || null, // { sentDate, eventDate, outcome }
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
  return { created, updated };
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

function createTouch({ accountId, funnel, stage, subject, body, ownerId, kind }) {
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
    status: 'pending_review', // pending_review | sent | replied | skipped
    createdAt: new Date().toISOString(),
    sentAt: null,
    repliedAt: null,
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

module.exports = {
  listAccounts,
  saveAccounts,
  getAccount,
  updateAccount,
  syncAccounts,
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
};
