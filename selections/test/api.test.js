'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SELECTIONS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rawdev-sel-'));
process.env.BUILDER_PASSWORD = 'test-pass';
delete process.env.SMTP_HOST;
delete process.env.SUBMIT_WEBHOOK_URL;

const app = require('../server');
const store = require('../lib/store');

let server, base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());
test.beforeEach(() => store._reset());

async function call(method, p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}
async function login() { const r = await call('POST', '/api/builder/login', { password: 'test-pass' }); assert.equal(r.status, 200); return r.body.token; }

test('builder endpoints need a session; wrong password is rejected', async () => {
  assert.equal((await call('GET', '/api/jobs')).status, 401);
  assert.equal((await call('POST', '/api/builder/login', { password: 'nope' })).status, 401);
  assert.equal((await call('GET', '/api/jobs', null, await login())).status, 200);
});

test('create a job, patch it, and read it back merged', async () => {
  const t = await login();
  const c = await call('POST', '/api/jobs', {}, t);
  assert.equal(c.status, 201);
  const job = c.body.job;
  assert.ok(job.id && job.token);
  assert.ok(Array.isArray(job.reps.bath) && job.reps.bath.length === 2, 'default bathrooms');

  let r = await call('PATCH', '/api/jobs/' + job.id, { patch: { data: { project: { 'job-details/client-name': 'Jordan Lee' }, kitchen: { 'cabinets-and-hardware/door-style': ['Shaker'] } } } }, t);
  assert.equal(r.status, 200);
  assert.equal(r.body.job.meta.client, 'Jordan Lee');
  assert.equal(r.body.job.rev, 2);

  r = await call('PATCH', '/api/jobs/' + job.id, { patch: { data: { kitchen: { 'cabinets-and-hardware/cabinet-construction': ['RTA'] } } } }, t);
  assert.deepEqual(r.body.job.data.kitchen, { 'cabinets-and-hardware/door-style': ['Shaker'], 'cabinets-and-hardware/cabinet-construction': ['RTA'] });

  // null deletes a key (used when a bathroom tab is removed)
  r = await call('PATCH', '/api/jobs/' + job.id, { patch: { data: { kitchen: null } } }, t);
  assert.equal(r.body.job.data.kitchen, undefined);

  const list = await call('GET', '/api/jobs', null, t);
  assert.equal(list.body.jobs.length, 1);
  assert.equal(list.body.jobs[0].meta.client, 'Jordan Lee');

  // conditional read returns 304 when nothing changed
  const res = await fetch(base + '/api/jobs/' + job.id + '?since=' + r.body.job.rev, { headers: { authorization: 'Bearer ' + t } });
  assert.equal(res.status, 304);
});

test('a client with the share link can read, save and submit; the builder sees the submission', async () => {
  const t = await login();
  const job = (await call('POST', '/api/jobs', {}, t)).body.job;

  let r = await call('GET', '/api/share/' + job.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.job.token, undefined, 'client response never includes the share token');

  r = await call('PATCH', '/api/share/' + job.token, { patch: { data: { project: { 'job-details/client-name': 'Sam Rivera' }, hvac: { 'heating-and-cooling/system-type': ['To select'] } } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.job.meta.client, 'Sam Rivera');

  r = await call('POST', '/api/share/' + job.token + '/submit', { name: 'Sam Rivera', note: 'Ready for review' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.delivered, [], 'no SMTP or webhook configured: saved only');
  assert.equal(r.body.job.submissions.length, 1);
  assert.equal(r.body.job.submissions[0].open, 1, 'one item still marked To select');

  const b = await call('GET', '/api/jobs/' + job.id, null, t);
  assert.equal(b.body.job.submissions[0].name, 'Sam Rivera');
  assert.equal(b.body.job.submissions[0].note, 'Ready for review');

  assert.equal((await call('GET', '/api/share/not-a-real-token')).status, 404);
});

test('a new link cuts off the old one, and archived jobs are closed to clients', async () => {
  const t = await login();
  const job = (await call('POST', '/api/jobs', {}, t)).body.job;
  const r = await call('POST', '/api/jobs/' + job.id + '/link', null, t);
  assert.notEqual(r.body.job.token, job.token);
  assert.equal((await call('GET', '/api/share/' + job.token)).status, 404);
  assert.equal((await call('GET', '/api/share/' + r.body.job.token)).status, 200);

  await call('POST', '/api/jobs/' + job.id + '/archive', { archived: true }, t);
  assert.equal((await call('GET', '/api/share/' + r.body.job.token)).status, 404);
  assert.equal((await call('GET', '/api/jobs/' + job.id, null, t)).body.job.archived, true);
});

test('a job can be started from a checklist saved on a device, and deleted', async () => {
  const t = await login();
  const from = { data: { kitchen: { 'sink-and-plumbing/kitchen-sink': ['Farmhouse'] } }, reps: { bath: [{ id: 'a1', name: 'Primary bath' }, { id: 'a2', name: 'Kids bath' }, { id: 'a3', name: 'Guest bath' }] } };
  const c = await call('POST', '/api/jobs', { from }, t);
  assert.equal(c.body.job.reps.bath.length, 3);
  assert.deepEqual(c.body.job.data.kitchen['sink-and-plumbing/kitchen-sink'], ['Farmhouse']);
  assert.equal((await call('DELETE', '/api/jobs/' + c.body.job.id, null, t)).status, 200);
  assert.equal((await call('GET', '/api/jobs/' + c.body.job.id, null, t)).status, 404);
});

test('share page and summary are served', async () => {
  const t = await login();
  const job = (await call('POST', '/api/jobs', {}, t)).body.job;
  const page = await fetch(base + '/s/' + job.token);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /New Build Selections Checklist/);
  const sum = await fetch(base + '/api/jobs/' + job.id + '/summary', { headers: { authorization: 'Bearer ' + t } });
  assert.equal(sum.status, 200);
  assert.match(await sum.text(), /Open items/);
});
