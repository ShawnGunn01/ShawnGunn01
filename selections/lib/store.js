'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deepMerge, clone } = require('./merge');
const { ROOMS } = require('../public/checklist');

const DATA_DIR = process.env.SELECTIONS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'jobs.json');

const uid = (n = 8) => crypto.randomBytes(n).toString('base64url');
const token = () => crypto.randomBytes(18).toString('base64url');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8').trim();
    cache = raw ? JSON.parse(raw) : { jobs: {}, sessions: {} };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    cache = { jobs: {}, sessions: {} };
  }
  cache.jobs ||= {};
  cache.sessions ||= {};
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}

function freshReps() {
  const reps = {};
  ROOMS.filter((r) => r.repeat).forEach((r) => { reps[r.id] = r.defaults.map((n) => ({ id: uid(4), name: n })); });
  return reps;
}

// Bring any job body (from the client, an old on-device copy, or disk) to the current shape.
function normalize(j) {
  j = j && typeof j === 'object' ? j : {};
  if (!j.data || typeof j.data !== 'object' || Array.isArray(j.data)) j.data = {};
  if (!j.reps || typeof j.reps !== 'object' || Array.isArray(j.reps)) j.reps = {};
  const fresh = freshReps();
  ROOMS.filter((r) => r.repeat).forEach((r) => {
    if (!Array.isArray(j.reps[r.id]) || !j.reps[r.id].length) j.reps[r.id] = fresh[r.id];
    j.reps[r.id] = j.reps[r.id].filter((i) => i && typeof i === 'object' && i.id).map((i) => ({ id: String(i.id), name: String(i.name || '') }));
  });
  if (!Array.isArray(j.signoffs)) j.signoffs = [];
  if (!Array.isArray(j.submissions)) j.submissions = [];
  return j;
}

function metaOf(job) {
  const p = job.data.project || {};
  const g = (k) => String(p['job-details/' + k] || '').trim();
  return { client: g('client-name'), address: g('project-address'), lot: g('lot-or-apn'), jobNo: g('job-number'), date: g('date') };
}

function listJobs() {
  return Object.values(load().jobs).map(summary).sort((a, b) => b.updatedAt - a.updatedAt);
}

function summary(job) {
  const { id, token: t, createdAt, updatedAt, rev, meta, signoffs, submissions, archived } = job;
  return { id, token: t, createdAt, updatedAt, rev, meta, archived: !!archived,
    signedVersion: signoffs.length ? signoffs[signoffs.length - 1].v : 0,
    lastSubmission: submissions.length ? submissions[submissions.length - 1] : null };
}

function createJob(seed) {
  const db = load();
  const base = normalize(clone(seed || {}));
  const now = Date.now();
  const job = { id: uid(6), token: token(), createdAt: now, updatedAt: now, rev: 1,
    data: base.data, reps: base.reps, signoffs: [], submissions: [], archived: false };
  job.meta = metaOf(job);
  db.jobs[job.id] = job;
  save();
  return job;
}

const getJob = (id) => load().jobs[id] || null;
const getJobByToken = (t) => t ? Object.values(load().jobs).find((j) => j.token === t) || null : null;

// Applies a patch ({data, reps, signoffs}) and bumps the revision. Unknown top-level keys are ignored.
function patchJob(id, patch) {
  const job = getJob(id);
  if (!job) return null;
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.data && typeof p.data === 'object') deepMerge(job.data, p.data);
  if (p.reps && typeof p.reps === 'object') job.reps = p.reps;
  if (Array.isArray(p.signoffs)) job.signoffs = p.signoffs;
  normalize(job);
  job.meta = metaOf(job);
  job.rev += 1;
  job.updatedAt = Date.now();
  save();
  return job;
}

function recordSubmission(id, sub) {
  const job = getJob(id);
  if (!job) return null;
  job.submissions.push(sub);
  job.rev += 1;
  job.updatedAt = Date.now();
  save();
  return job;
}

function updateJobFields(id, fields) {
  const job = getJob(id);
  if (!job) return null;
  Object.assign(job, fields);
  job.rev += 1;
  job.updatedAt = Date.now();
  save();
  return job;
}

function deleteJob(id) {
  const db = load();
  if (!db.jobs[id]) return false;
  delete db.jobs[id];
  save();
  return true;
}

// Builder sessions: a random bearer token per sign-in, kept on disk so a restart does not sign everyone out.
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
function createSession() {
  const db = load();
  const t = token();
  db.sessions[t] = { createdAt: Date.now() };
  save();
  return t;
}
function validSession(t) {
  const db = load();
  const s = t && db.sessions[t];
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL) { delete db.sessions[t]; save(); return false; }
  return true;
}
function destroySession(t) { const db = load(); if (db.sessions[t]) { delete db.sessions[t]; save(); } }

function _reset() { cache = { jobs: {}, sessions: {} }; save(); }

module.exports = { listJobs, summary, createJob, getJob, getJobByToken, patchJob, recordSubmission, updateJobFields, deleteJob,
  createSession, validSession, destroySession, normalize, metaOf, freshReps, uid, _reset, FILE };
