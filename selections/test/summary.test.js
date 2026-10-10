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

test('pricing totals allowance and cost per selection and reports over or under', () => {
  const j = store.normalize({ data: {
    kitchen: { 'countertops-backsplash-and-island/countertop-material': ['Quartzite'], 'countertops-backsplash-and-island/countertop-material#allow': 6000, 'countertops-backsplash-and-island/countertop-material#cost': 7250 },
    floor: { 'flooring-and-trim-selections/flooring-type': ['Engineered hardwood'], 'flooring-and-trim-selections/flooring-type#allow': 12000, 'flooring-and-trim-selections/flooring-type#cost': 11000 },
    paint: { 'painting-selections/interior-walls#cost': 500 } } });
  const pr = S.pricing(j);
  assert.equal(pr.n, 3);
  assert.equal(pr.allow, 18000);
  assert.equal(pr.cost, 18750);
  assert.equal(pr.diff, 750);
  assert.equal(pr.items[0].value, 'Quartzite');
  assert.equal(S.diffText(pr.items[0].diff), 'Over $1,250');
  assert.equal(S.diffText(pr.items[1].diff), 'Under $1,000');
  assert.equal(pr.items[2].allow, null);
  assert.match(S.summaryText(j, false), /Total allowance \$18,000, total cost \$18,750: over \$750/);
  assert.match(S.summaryHTML(j), /<h2>Pricing<\/h2>/);
  assert.equal(S.pricing(store.normalize({})).n, 0);
  assert.doesNotMatch(S.summaryHTML(store.normalize({})), /<h2>Pricing<\/h2>/);
});

test('a price change after signing counts as a change to the sheet', () => {
  const j = store.normalize({ data: { kitchen: { 'a/b': ['X'], 'a/b#cost': 100 } } });
  j.signoffs.push({ v: 1, name: 'Ana Cruz', at: Date.now(), open: 0, hash: S.hashJob(j) });
  assert.equal(S.status(j).signed, true);
  j.data.kitchen['a/b#cost'] = 150;
  assert.equal(S.status(j).signed, false);
});
