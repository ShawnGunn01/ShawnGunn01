'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/summary');
const store = require('../lib/store');

test('hash ignores key order and empty room objects, so a signature holds across devices', () => {
  const reps = store.freshReps();
  const a = store.normalize({ data: { kitchen: { 'a/b': ['X'], 'a/c': 'note' }, project: {} }, reps });
  const b = store.normalize({ data: { kitchen: { 'a/c': 'note', 'a/b': ['X'] }, 'bath:1': {}, misc: { 'a/d': '' } }, reps });
  assert.equal(S.hashJob(a), S.hashJob(b));
  const c = store.normalize({ data: { kitchen: { 'a/b': ['Y'], 'a/c': 'note' } }, reps });
  assert.notEqual(S.hashJob(a), S.hashJob(c));
});

test('status reflects signing and later changes', () => {
  const j = store.normalize({ data: { kitchen: { 'a/b': ['X'] } } });
  assert.equal(S.status(j).signed, false);
  j.signoffs.push({ v: 1, name: 'Ana Cruz', at: Date.now(), open: 0, hash: S.hashJob(j) });
  assert.equal(S.status(j).signed, true);
  j.data.kitchen['a/b'] = ['Z'];
  const st = S.status(j);
  assert.equal(st.signed, false);
  assert.equal(st.next, 2);
});

test('open items list everything still marked To select or To confirm', () => {
  const j = store.normalize({ data: { hvac: { 'heating-and-cooling/system-type': ['To select'] }, plumb: { 'whole-house-plumbing/pressure-regulator': ['To confirm'] } } });
  const open = S.openItems(j);
  assert.equal(open.length, 2);
  assert.equal(open[0].title, 'HVAC and water heating');
});
