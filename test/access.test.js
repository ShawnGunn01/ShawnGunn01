const test = require('node:test');
const assert = require('node:assert/strict');

const { canAccess } = require('../src/access');

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
