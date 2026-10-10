'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./lib/store');
const mail = require('./lib/mail');
const SUMMARY = require('./public/summary');
const PDF = require('./lib/pdf');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Client share links open the same page; the app reads the token from the path.
app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const BUILDER_PASSWORD = process.env.BUILDER_PASSWORD || '';
const safeEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

// Only accepts a bearer session token issued by /api/builder/login.
function builderOnly(req, res, next) {
  const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!store.validSession(t)) return res.status(401).json({ error: 'Sign in as the builder first.' });
  req.session = t;
  next();
}

// A small per-IP throttle on sign-in attempts.
const attempts = new Map();
function throttle(req, res, next) {
  const now = Date.now(), a = attempts.get(req.ip) || { n: 0, at: now };
  if (now - a.at > 15 * 60 * 1000) { a.n = 0; a.at = now; }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  req.onFail = () => { a.n++; attempts.set(req.ip, a); };
  next();
}

const clientJob = (job) => ({ id: job.id, rev: job.rev, updatedAt: job.updatedAt, meta: job.meta, data: job.data, reps: job.reps, signoffs: job.signoffs, submissions: job.submissions });
const builderJob = (job) => ({ ...clientJob(job), token: job.token, createdAt: job.createdAt, archived: !!job.archived });

app.get('/api/config', (req, res) => {
  const cfg = mail.config();
  res.json({ builderEmail: cfg.builderEmail, builderLogin: !!BUILDER_PASSWORD, delivery: cfg.smtp ? 'email' : cfg.webhook ? 'webhook' : 'saved' });
});

/* ---- Builder sign-in ---- */
app.post('/api/builder/login', throttle, (req, res) => {
  const pw = (req.body && req.body.password) || '';
  if (!BUILDER_PASSWORD) return res.status(503).json({ error: 'Builder sign-in is not set up. Set BUILDER_PASSWORD on the server.' });
  if (!safeEqual(pw, BUILDER_PASSWORD)) { req.onFail(); return res.status(401).json({ error: 'That password is not right.' }); }
  res.json({ token: store.createSession() });
});
app.post('/api/builder/logout', builderOnly, (req, res) => { store.destroySession(req.session); res.json({ ok: true }); });
app.get('/api/builder/me', builderOnly, (req, res) => res.json({ ok: true }));

/* ---- Jobs (builder) ---- */
app.get('/api/jobs', builderOnly, (req, res) => res.json({ jobs: store.listJobs() }));
app.post('/api/jobs', builderOnly, (req, res) => {
  const seed = req.body && req.body.from && typeof req.body.from === 'object' ? req.body.from : null;
  res.status(201).json({ job: builderJob(store.createJob(seed)) });
});
app.get('/api/jobs/:id', builderOnly, (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job.' });
  if (req.query.since && Number(req.query.since) === job.rev) return res.status(304).end();
  res.json({ job: builderJob(job) });
});
app.patch('/api/jobs/:id', builderOnly, (req, res) => {
  const job = store.patchJob(req.params.id, req.body && req.body.patch);
  if (!job) return res.status(404).json({ error: 'No such job.' });
  res.json({ job: builderJob(job) });
});
app.post('/api/jobs/:id/link', builderOnly, (req, res) => {
  const job = store.updateJobFields(req.params.id, { token: store.uid(18) });
  if (!job) return res.status(404).json({ error: 'No such job.' });
  res.json({ job: builderJob(job) });
});
app.post('/api/jobs/:id/archive', builderOnly, (req, res) => {
  const job = store.updateJobFields(req.params.id, { archived: !!(req.body && req.body.archived) });
  if (!job) return res.status(404).json({ error: 'No such job.' });
  res.json({ job: builderJob(job) });
});
app.delete('/api/jobs/:id', builderOnly, (req, res) => {
  if (!store.deleteJob(req.params.id)) return res.status(404).json({ error: 'No such job.' });
  res.json({ ok: true });
});
app.get('/api/jobs/:id/summary', builderOnly, (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job.' });
  res.type('html').send(SUMMARY.summaryDoc(job, { builderEmail: mail.config().builderEmail }));
});
// The summary as a PDF, for the builder (by job id) and the client (by share link).
async function sendPDF(res, job) {
  const buf = await PDF.summaryPDF(job, { builderEmail: mail.config().builderEmail });
  const m = SUMMARY.metaOf(job), st = SUMMARY.status(job);
  const name = `Selections - ${[m.client, m.address].filter(Boolean).join(' - ') || 'New build'} - ${st.signed ? 'v' + st.last.v : 'draft'}.pdf`.replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
}
app.get('/api/jobs/:id/summary.pdf', builderOnly, async (req, res, next) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job.' });
  try { await sendPDF(res, job); } catch (e) { next(e); }
});

/* ---- Client access by share link ---- */
function byToken(req, res, next) {
  const job = store.getJobByToken(req.params.token);
  if (!job || job.archived) return res.status(404).json({ error: 'This link is not active. Ask Raw Development for a new one.' });
  req.job = job;
  next();
}
app.get('/api/share/:token', byToken, (req, res) => {
  if (req.query.since && Number(req.query.since) === req.job.rev) return res.status(304).end();
  res.json({ job: clientJob(req.job) });
});
app.get('/api/share/:token/summary.pdf', byToken, async (req, res, next) => {
  try { await sendPDF(res, req.job); } catch (e) { next(e); }
});
app.patch('/api/share/:token', byToken, (req, res) => {
  const job = store.patchJob(req.job.id, req.body && req.body.patch);
  res.json({ job: clientJob(job) });
});
app.post('/api/share/:token/submit', byToken, async (req, res) => {
  const b = req.body || {};
  const sub = { at: Date.now(), name: String(b.name || '').trim().slice(0, 120), note: String(b.note || '').trim().slice(0, 2000),
    open: SUMMARY.openItems(req.job).length, version: SUMMARY.status(req.job).signed ? SUMMARY.status(req.job).last.v : null, delivered: [] };
  const result = await mail.deliver(req.job, sub);
  sub.delivered = result.delivered;
  const job = store.recordSubmission(req.job.id, sub);
  res.json({ job: clientJob(job), delivered: result.delivered, errors: result.errors });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  if (!BUILDER_PASSWORD) console.warn('BUILDER_PASSWORD is not set: builder sign-in is disabled until you set it.');
  app.listen(PORT, () => console.log(`Raw Development selections running on http://localhost:${PORT}`));
}

module.exports = app;
