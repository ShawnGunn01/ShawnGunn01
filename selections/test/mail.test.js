'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mail = require('../lib/mail');
const store = require('../lib/store');

const job = () => {
  const j = store.normalize({ data: { project: { 'job-details/client-name': 'Ana Cruz', 'job-details/project-address': '123 Lake Ave, Altadena' },
    kitchen: { 'cabinets-and-hardware/door-style': ['Other'], 'cabinets-and-hardware/door-style#o': 'Beaded inset', 'sink-and-plumbing/kitchen-sink': ['To select'] } } });
  j.id = 'abc123'; j.meta = store.metaOf(j); return j;
};

test('submission email carries the job, open items, selections and a link', () => {
  const cfg = mail.config({ BUILDER_EMAIL: 'team@example.com', PUBLIC_URL: 'https://selections.example.com/' });
  const msg = mail.buildMessage(job(), { name: 'Ana Cruz', note: 'See kitchen' }, cfg);
  assert.equal(msg.to, 'team@example.com');
  assert.equal(msg.subject, 'Selections: Ana Cruz, 123 Lake Ave, Altadena');
  assert.match(msg.text, /See kitchen/);
  assert.match(msg.text, /https:\/\/selections\.example\.com\/\?job=abc123/);
  assert.match(msg.text, /OPEN ITEMS \(1\)/);
  assert.match(msg.text, /Door style: Other: Beaded inset/);
  assert.match(msg.attachment.content, /<h2>Kitchen<\/h2>/);
});

test('deliver uses SMTP and the webhook when configured, and reports what worked', async () => {
  const sent = [], posted = [];
  const cfg = mail.config({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'no-reply@example.com', SUBMIT_WEBHOOK_URL: 'https://hooks.example.com/x' });
  const r = await mail.deliver(job(), { name: 'Ana' }, { config: cfg, log: () => {},
    transportFactory: () => ({ sendMail: async (m) => { sent.push(m); } }),
    fetch: async (url, opts) => { posted.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; } });
  assert.deepEqual(r.delivered, ['email', 'webhook']);
  assert.equal(sent[0].from, 'no-reply@example.com');
  assert.equal(sent[0].attachments[0].filename, 'selections.html');
  assert.equal(posted[0].body.jobId, 'abc123');
  assert.equal(posted[0].body.openItems.length, 1);
});

test('a failing channel is reported, not thrown', async () => {
  const cfg = mail.config({ SUBMIT_WEBHOOK_URL: 'https://hooks.example.com/x' });
  const r = await mail.deliver(job(), {}, { config: cfg, log: () => {}, fetch: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(r.delivered, []);
  assert.match(r.errors[0], /webhook responded 500/);
});
