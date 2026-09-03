const test = require('node:test');
const assert = require('node:assert/strict');

const { canAccess, resolveQueueScope } = require('../src/access');

// Fake store — resolveQueueScope only ever calls store.getOwner, so a tiny
// fake keeps these tests fast and independent of the JSON file store.
function fakeStore(owners) {
  return { getOwner: (id) => owners.find((o) => o.id === id) || null };
}
const OWNERS = [
  { id: 'audrey', backupFor: 'nick' }, // Audrey is backup FOR Nick
  { id: 'nick', backupFor: 'audrey' }, // Nick is backup FOR Audrey
];

test('admin can access admin-gated actions', () => {
  assert.equal(canAccess({ id: 'shawn', role: 'admin' }, 'admin'), true);
  assert.equal(canAccess({ id: 'ira', role: 'admin' }, 'admin'), true);
});

test('viewer cannot access admin-gated actions', () => {
  assert.equal(canAccess({ id: 'audrey', role: 'viewer' }, 'admin'), false);
  assert.equal(canAccess({ id: 'nick', role: 'viewer' }, 'admin'), false);
});

test('any recognized user (including viewer) can access view-only actions', () => {
  assert.equal(canAccess({ id: 'audrey', role: 'viewer' }, undefined), true);
  assert.equal(canAccess({ id: 'shawn', role: 'admin' }, undefined), true);
});

test('no user at all cannot access anything, including view-only', () => {
  assert.equal(canAccess(null, undefined), false);
  assert.equal(canAccess(null, 'admin'), false);
});

// ---------- resolveQueueScope (Prompt 8 Item 1 — per-owner queue + backup access) ----------

test('resolveQueueScope: with no asOwner, a viewer is scoped to their own queue', () => {
  const scope = resolveQueueScope({ id: 'audrey', role: 'viewer', name: 'Audrey' }, {}, fakeStore(OWNERS));
  assert.deepEqual(scope, { ownerId: 'audrey', isBackup: false });
});

test('resolveQueueScope: asOwner equal to your own id is a no-op, not backup mode', () => {
  const scope = resolveQueueScope({ id: 'audrey', role: 'viewer', name: 'Audrey' }, { asOwner: 'audrey' }, fakeStore(OWNERS));
  assert.deepEqual(scope, { ownerId: 'audrey', isBackup: false });
});

test('resolveQueueScope: admins see everything, optionally filterable, never flagged as backup', () => {
  assert.deepEqual(resolveQueueScope({ id: 'shawn', role: 'admin', name: 'Shawn' }, {}, fakeStore(OWNERS)), { ownerId: null, isBackup: false });
  assert.deepEqual(resolveQueueScope({ id: 'shawn', role: 'admin', name: 'Shawn' }, { ownerId: 'nick' }, fakeStore(OWNERS)), { ownerId: 'nick', isBackup: false });
});

test('resolveQueueScope: a documented backup relationship, WITH a reason, is granted and flagged', () => {
  const scope = resolveQueueScope({ id: 'audrey', role: 'viewer', name: 'Audrey' }, { asOwner: 'nick', backupReason: 'Nick is out sick' }, fakeStore(OWNERS));
  assert.deepEqual(scope, { ownerId: 'nick', isBackup: true, reason: 'Nick is out sick' });
});

test('resolveQueueScope: a documented backup relationship WITHOUT a reason is rejected', () => {
  const scope = resolveQueueScope({ id: 'audrey', role: 'viewer', name: 'Audrey' }, { asOwner: 'nick' }, fakeStore(OWNERS));
  assert.match(scope.error, /backupReason is required/);
});

test('resolveQueueScope: no documented backup relationship is rejected even with a reason given', () => {
  const scope = resolveQueueScope({ id: 'audrey', role: 'viewer', name: 'Audrey' }, { asOwner: 'someone-else', backupReason: 'trying anyway' }, fakeStore(OWNERS));
  assert.match(scope.error, /not the designated backup/);
});

test('resolveQueueScope: an unrecognized user is rejected outright', () => {
  const scope = resolveQueueScope(null, { asOwner: 'nick', backupReason: 'x' }, fakeStore(OWNERS));
  assert.ok(scope.error);
});
