/* Raw Development Design, New Build Selections: browser app.
   Three ways in:
     client  - opened from a share link (/s/<token>); saves to the job record on the server
     builder - signed in with the builder password; sees every job, makes share links
     local   - no link and not signed in; saves on this device only (same as the original checklist) */
(function () {
'use strict';
const { ROOMS, PROJECT, ALL, SOFT, OPEN_RE, FORM_REV } = window.CHECKLIST;
const S = window.SUMMARY;
const esc = S.esc, fmtDate = S.fmtDate;

const LKEY = 'rawdev-new-build-selections-v1';
const UKEY = 'rawdev-selections-ui-v3';
const BKEY = 'rawdev-builder-session';
const JOB_FIELDS = [['client-name', 'Client'], ['project-address', 'Address'], ['lot-or-apn', 'Lot / APN'], ['job-number', 'Job #'], ['date', 'Date']];
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
function deepMerge(t, p) {
  Object.keys(p || {}).forEach((k) => {
    const v = p[k];
    if (v === null) { delete t[k]; return; }
    if (v && typeof v === 'object' && !Array.isArray(v)) { if (!t[k] || typeof t[k] !== 'object' || Array.isArray(t[k])) t[k] = {}; deepMerge(t[k], v); }
    else t[k] = v;
  });
  return t;
}

function freshJob() {
  const reps = {};
  ROOMS.filter((r) => r.repeat).forEach((r) => { reps[r.id] = r.defaults.map((n) => ({ id: uid(), name: n })); });
  return { data: {}, reps, signoffs: [], submissions: [] };
}
function normJob(j) {
  j = j && typeof j === 'object' ? j : {};
  const f = freshJob();
  if (!j.data || typeof j.data !== 'object') j.data = {};
  if (!j.reps || typeof j.reps !== 'object') j.reps = f.reps;
  ROOMS.filter((r) => r.repeat).forEach((r) => { if (!Array.isArray(j.reps[r.id]) || !j.reps[r.id].length) j.reps[r.id] = f.reps[r.id]; });
  if (!Array.isArray(j.signoffs)) j.signoffs = [];
  if (!Array.isArray(j.submissions)) j.submissions = [];
  return j;
}

/* ---------- State ---------- */
let config = { builderEmail: 'Treese@rawdevelopment.com', builderLogin: true, delivery: 'saved' };
let ui = { room: 'project', cur: {}, lastJob: null };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UKEY)) || {}); } catch (e) {}
let localJob;
try { const raw = JSON.parse(localStorage.getItem(LKEY)); localJob = normJob(raw ? { data: raw.data, reps: raw.reps, signoffs: raw.signoffs } : null); }
catch (e) { localJob = freshJob(); }
let job = localJob;
let mode = 'local';                 // 'local' | 'client' | 'builder'
let shareToken = null;              // client mode
let session = null;                 // builder mode
try { session = localStorage.getItem(BKEY) || null; } catch (e) {}
let jobId = null, jobRev = 0, jobsList = [], jobsLoaded = false, jobToken = null, jobArchived = false;
let pending = null, writing = false, flushTimer = null, stale = false, pollTimer = null, offline = false;

const m = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
if (m) shareToken = m[1];
const qs = new URLSearchParams(location.search);
if (qs.get('t')) shareToken = qs.get('t');

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (session) headers.authorization = 'Bearer ' + session;
  const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 304) return null;
  let body = null; try { body = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error((body && body.error) || ('Request failed (' + res.status + ')')); err.status = res.status; throw err; }
  return body;
}
const jobPath = () => (mode === 'client' ? '/api/share/' + encodeURIComponent(shareToken) : '/api/jobs/' + encodeURIComponent(jobId));

/* ---------- Saving ---------- */
function saveUI() { try { localStorage.setItem(UKEY, JSON.stringify(ui)); } catch (e) {} }
function setSave(t) { document.getElementById('saveState').textContent = t; }
function saveLocal() {
  try { localStorage.setItem(LKEY, JSON.stringify({ data: job.data, reps: job.reps, signoffs: job.signoffs })); setSave('Saved on this device only'); }
  catch (e) { setSave('Not saved. Send or print before closing'); }
}
function persist(p) {
  if (mode === 'local') { clearTimeout(flushTimer); flushTimer = setTimeout(saveLocal, 250); return; }
  if (!p) return;
  pending = deepMerge(pending || {}, p);
  setSave('Saving…');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 500);
}
async function flush() {
  if (mode === 'local' || !pending) return;
  if (writing) { flushTimer = setTimeout(flush, 400); return; }
  writing = true;
  const p = pending; pending = null;
  try {
    const r = await api(jobPath(), { method: 'PATCH', body: { patch: p } });
    applyServerJob(r.job, true);
    offline = false;
    setSave(mode === 'client' ? 'Saved to Raw Development' : 'Saved to job record');
  } catch (e) {
    pending = deepMerge(p, pending || {});
    if (e.status === 404) { closeJob(e.message); }
    else if (e.status === 401) { signOut('Your builder sign-in expired. Sign in again.'); }
    else { offline = true; setSave('Not saved. Check your connection'); writing = false; clearTimeout(flushTimer); flushTimer = setTimeout(flush, 3000); return; }
  }
  writing = false;
  if (pending) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 400); }
}
function flushNow() {
  if (mode === 'local') { clearTimeout(flushTimer); saveLocal(); }
  else if (pending) { clearTimeout(flushTimer); flushTimer = null; flush(); }
}
addEventListener('pagehide', flushNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); else if (mode !== 'local') poll(); });

// Takes a job body from the server. Our own unsent edits (pending) win over what came back.
function applyServerJob(body, fromWrite) {
  if (!body) return;
  jobRev = body.rev; jobToken = body.token || jobToken; jobArchived = !!body.archived;
  if (mode === 'builder') { const row = jobsList.find((j) => j.id === body.id); if (row) Object.assign(row, { meta: body.meta, updatedAt: body.updatedAt, archived: jobArchived }); }
  const before = JSON.stringify({ d: job.data, r: job.reps, s: job.signoffs, u: job.submissions });
  const next = normJob(clone({ data: body.data, reps: body.reps, signoffs: body.signoffs, submissions: body.submissions }));
  if (pending) deepMerge(next, clone(pending));
  job = next;
  if (fromWrite) return;
  if (JSON.stringify({ d: job.data, r: job.reps, s: job.signoffs, u: job.submissions }) === before) return;
  if (main.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { stale = true; renderNav(); }
  else render();
}
async function poll() {
  if (mode === 'local' || (!jobId && !shareToken) || writing || pending) return;
  try { const r = await api(jobPath() + '?since=' + jobRev); if (r) applyServerJob(r.job); if (offline) { offline = false; setSave(mode === 'client' ? 'Saved to Raw Development' : 'Saved to job record'); } }
  catch (e) { if (e.status === 404) closeJob(e.message); else if (e.status === 401) signOut('Your builder sign-in expired. Sign in again.'); }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(poll, 6000); }

function setField(scope, k, v) { (job.data[scope] ||= {})[k] = v; persist({ data: { [scope]: { [k]: v } } }); }
function persistReps() { persist({ reps: job.reps }); }

/* ---------- Helpers bound to the current job ---------- */
const scopeOf = S.scopeOf;
const bag = (scope) => (job.data[scope] ||= {});
const countScope = (room, scope) => S.countScope(job, room, scope);
const countRoom = (room) => S.countRoom(job, room);
const openItems = () => S.openItems(job);
const status = () => S.status(job);
const metaOf = () => S.metaOf(job);

/* ---------- Rendering ---------- */
const nav = document.getElementById('nav'), main = document.getElementById('main'), jobbar = document.getElementById('jobbar');
const resetBtn = document.getElementById('resetBtn'), builderBtn = document.getElementById('builderBtn');

function renderJobbar() {
  if (mode === 'builder' && !jobId) { jobbar.innerHTML = ''; return; }
  const mt = metaOf(), st = status(), open = openItems().length;
  const parts = JOB_FIELDS.map(([k, l]) => { const v = mt[{ 'client-name': 'client', 'project-address': 'address', 'lot-or-apn': 'lot', 'job-number': 'jobNo', 'date': 'date' }[k]]; return `<span><b>${l}</b> ${v ? esc(v) : '<i>Not entered</i>'}</span>`; }).join('');
  jobbar.innerHTML = `<div class="jb-inner"><div class="jb-fields">${parts}</div>
    <div class="jb-status"><span class="pill ${st.signed ? 'ok' : ''}">${esc(st.signed ? 'Signed v' + st.last.v : (st.last ? 'Unsigned changes' : 'Draft'))}</span>
    <button type="button" class="pill open" data-go="review">${open} open item${open === 1 ? '' : 's'}</button>
    ${mode === 'builder' ? `<button type="button" class="pill" data-go="jobs">All jobs</button>` : ''}</div></div>`;
}
function renderNav() {
  if (mode === 'builder' && !jobId) { nav.innerHTML = ''; renderJobbar(); return; }
  nav.innerHTML = ALL.map((r) => {
    const [d, t] = countRoom(r);
    const label = r.repeat ? `${r.name} (${job.reps[r.id].length})` : r.name;
    return `<button class="room-btn" data-room="${r.id}" aria-current="${ui.room === r.id}" type="button">
      <span>${esc(label)}</span><span class="n">${d}/${t}</span>
      <span class="bar"><i style="width:${t ? (d / t * 100) : 0}%"></i></span></button>`;
  }).join('');
  renderJobbar();
}
function fieldHTML(f, sec, d) {
  const k = sec.key + '/' + f.key;
  const hint = f.hint ? `<em>${esc(f.hint)}</em>` : (f.multi ? `<em>Pick all that apply</em>` : '');
  let body;
  if (f.text) body = `<textarea class="txt" rows="1" data-f="${k}" aria-label="${esc(f.label)}">${esc(d[k] || '')}</textarea>`;
  else {
    const sel = d[k] || [];
    body = `<div class="chips">` + f.opts.map((o) => {
      const on = sel.includes(o);
      const cls = 'chip' + (f.multi ? '' : ' single') + (SOFT.has(o) || OPEN_RE.test(o) ? ' soft' : '');
      let h = `<button type="button" class="${cls}" data-f="${k}" data-o="${esc(o)}" data-m="${f.multi ? 1 : 0}" aria-pressed="${on}">${esc(o.startsWith('Other') ? o + '…' : o)}</button>`;
      if (o.startsWith('Other') && on) h += `<input class="other" data-f="${k}#o" placeholder="Describe" value="${esc(d[k + '#o'] || '')}" aria-label="${esc(f.label)} other">`;
      return h;
    }).join('') + `</div>`;
  }
  return `<div class="row" data-row="${k}"><div class="lbl">${esc(f.label)}${hint}</div><div>${body}</div></div>`;
}
const shareURL = (t) => location.origin + '/s/' + t;
function jobsHTML() {
  if (mode !== 'builder') return '';
  const rows = jobsList.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((j) => {
    const mt = j.meta || {}, cur = j.id === jobId;
    const name = [mt.client, mt.address].filter(Boolean).join(' · ') || 'Untitled job';
    const sub = [mt.lot && 'Lot ' + mt.lot, mt.jobNo && 'Job ' + mt.jobNo, j.updatedAt && 'Updated ' + fmtDate(j.updatedAt),
      j.lastSubmission && 'Sent ' + fmtDate(j.lastSubmission.at), j.signedVersion && 'Signed v' + j.signedVersion].filter(Boolean).join(' · ');
    return `<div class="job ${cur ? 'cur' : ''} ${j.archived ? 'meta-arch' : ''}"><button type="button" class="job-open" data-job="${esc(j.id)}"><b>${esc(name)}${j.archived ? '<span class="tag">Archived</span>' : ''}</b><span>${esc(sub)}</span></button>
      ${cur ? '<span class="pill ok">Open</span>' : `<button type="button" class="link danger" data-deljob="${esc(j.id)}">Delete</button>`}</div>`;
  }).join('');
  const hasLocal = Object.values(localJob.data).some((s) => s && Object.values(s).some((v) => v && (Array.isArray(v) ? v.length : String(v).trim())));
  return `<fieldset class="jobs"><legend>Jobs</legend>
    <p class="hint">Each job is its own saved record. Open it from any phone or computer, or send the client their link and their answers save here as they go.</p>
    ${!jobsLoaded ? '<p class="hint">Loading jobs…</p>' : (rows || '<p class="hint">No jobs yet. Start one below.</p>')}
    <div class="job-actions"><button type="button" class="btn gold-b" data-newjob="1">+ New job</button>
    ${hasLocal ? '<button type="button" class="btn" data-newjob="local">New job from checklist saved on this device</button>' : ''}
    <button type="button" class="btn" id="signOutBtn">Sign out</button></div>
    <p class="msg" id="jobMsg"></p></fieldset>`;
}
function shareHTML() {
  if (mode !== 'builder' || !jobId) return '';
  const subs = job.submissions.slice().reverse().map((s) => `<tr><td>${esc(fmtDate(s.at))}</td><td>${esc(s.name || 'Client')}</td><td>${s.open} open${s.version ? ', v' + s.version + ' signed' : ''}</td><td>${esc((s.delivered || []).join(', ') || 'saved')}</td></tr>`).join('');
  return `<fieldset><legend>Client link</legend>
    <p class="hint">Send this link to the client. Anyone with it can fill in this job from their own phone or computer, and every change saves here. Make a new link to cut off the old one.</p>
    <div class="share"><input readonly value="${esc(shareURL(jobToken))}" id="shareUrl" aria-label="Client link"><button type="button" class="btn gold-b" id="copyLink">Copy link</button><button type="button" class="link" id="newLink">Make a new link</button></div>
    <div class="job-actions"><a class="btn" href="/api/jobs/${esc(jobId)}/summary" target="_blank" rel="noopener" id="summaryLink">Open summary</a>
      <button type="button" class="btn" id="archiveBtn">${jobArchived ? 'Unarchive job' : 'Archive job'}</button></div>
    ${subs ? `<p class="hint"><b>Sent to builder</b></p><table class="subs">${subs}</table>` : '<p class="hint">The client has not sent this job yet.</p>'}
    <p class="msg" id="shareMsg"></p></fieldset>`;
}
function openItemsHTML(list) {
  if (!list.length) return `<div class="notice">No items are marked "To select" or "To confirm".</div>`;
  return `<fieldset class="openlist"><legend>Open items (${list.length})</legend><p class="hint">Still marked "To select" or "To confirm". Tap one to go to it.</p><ul>` +
    list.map((o) => `<li><button type="button" data-jump="${esc(o.room)}|${esc(o.inst || '')}|${esc(o.key)}"><b>${esc(o.title)}</b> › ${esc(o.section)} › ${esc(o.label)} <span>${esc(o.value)}</span></button></li>`).join('') +
    `</ul></fieldset>`;
}
function signoffHTML() {
  const st = status(), open = openItems().length;
  const hist = job.signoffs.slice().reverse().map((s) => `<tr><td>v${s.v}</td><td>${esc(s.name)}</td><td>${esc(fmtDate(s.at))}</td><td>${s.open} open</td></tr>`).join('');
  return `<fieldset><legend>Sign-off</legend>
    <p class="status-line ${st.signed ? 'ok' : ''}">${esc(st.text)}</p>
    ${st.signed ? '' : `<div class="sign-row"><label for="signName">Client full name</label><input id="signName" placeholder="Type full name to sign" autocomplete="name">
      <button type="button" class="btn gold-b" id="signBtn">Sign version ${st.next}</button></div>
      ${open ? `<p class="hint">${open} item${open === 1 ? ' is' : 's are'} still open. Signing now means ${open === 1 ? 'it defaults' : 'they default'} to Raw Development standard.</p>` : ''}`}
    ${hist ? `<table class="hist"><thead><tr><th>Version</th><th>Signed by</th><th>Date</th><th>Open</th></tr></thead><tbody>${hist}</tbody></table>` : ''}
    <p class="hint">${FORM_REV}. Any change after signing creates a new draft that needs a new signature.</p></fieldset>`;
}
function sendHTML() {
  const last = job.submissions[job.submissions.length - 1];
  if (mode === 'client') {
    return `<fieldset id="sendBox"><legend>Send to builder</legend>
      <p class="hint">Your selections already save to Raw Development as you go. Sending tells the team you're ready for them to review${config.delivery === 'email' ? ' and emails them the full summary' : ''}.</p>
      ${last ? `<p class="status-line ok">Last sent ${esc(fmtDate(last.at))}${last.name ? ' by ' + esc(last.name) : ''}.</p>` : ''}
      <div class="send-row"><input id="sendName" placeholder="Your name" autocomplete="name"><textarea id="sendNote" rows="2" placeholder="Anything the team should know (optional)"></textarea></div>
      <div class="job-actions"><button type="button" class="btn gold-b" id="submitBtn">Send selections to Raw Development</button>
      <button type="button" class="btn" data-print>Print or save as PDF</button></div><p class="msg" id="sendMsg"></p></fieldset>`;
  }
  return `<fieldset id="sendBox"><legend>${mode === 'builder' ? 'Share and print' : 'Send to builder'}</legend>
    <p class="hint">${mode === 'builder' ? 'Email the summary to anyone, download it, or print it.' : 'Emails the job details, open items and every selection to Raw Development. For long checklists, also download the summary file and attach it.'}</p>
    <div class="job-actions"><a class="btn gold-b" id="mailBtn" href="#" target="_blank" rel="noopener">Email selections${mode === 'builder' ? '' : ' to builder'}</a>
    <button type="button" class="btn" id="dlBtn">Download summary file</button>
    <button type="button" class="btn" data-print>Print or save as PDF</button></div><p class="msg" id="sendMsg"></p></fieldset>`;
}
function loginHTML(msg) {
  return `<div class="room-head"><h2>Builder sign in</h2></div><fieldset class="login"><legend>Raw Development team</legend>
    <p class="hint">Sign in to see every client's job, make share links, and review what's been sent.</p>
    <label for="pw">Builder password</label><input id="pw" type="password" autocomplete="current-password">
    <div class="job-actions"><button type="button" class="btn gold-b" id="loginBtn">Sign in</button><button type="button" class="btn" id="cancelLogin">Back to checklist</button></div>
    <p class="msg" id="loginMsg">${esc(msg || '')}</p></fieldset>`;
}

let showLogin = false;
function renderRoom() {
  if (showLogin) { main.innerHTML = loginHTML(); main.dataset.scope = ''; const pw = document.getElementById('pw'); if (pw) pw.focus(); return; }
  if (mode === 'builder' && !jobId) { main.innerHTML = `<div class="room-head"><h2>Choose a job</h2></div>` + jobsHTML(); main.dataset.scope = ''; return; }
  const room = ALL.find((r) => r.id === ui.room) || PROJECT;
  const idx = ALL.indexOf(room);
  let inst, html = '';
  const [d0, t0] = countRoom(room);
  html += `<div class="room-head"><h2>${esc(room.name)}</h2><p>${d0} of ${t0} selections made</p></div>`;
  if (offline) html += `<div class="offline">You're offline or the server can't be reached. Your edits are kept here and will save when the connection is back.</div>`;
  if (room.id === 'project') {
    html += jobsHTML() + shareHTML();
    html += `<p class="intro">Tap your preferred option for each item and write in the size, finish, brand, and model number where you know them. If you're undecided, choose "To select." Start with the job details, then tell us how many bathrooms and bedrooms the house has; each one gets its own page of selections.</p><div class="notice">Order early: windows and sliders, the front door, garage door, appliances, and steam units have the longest lead times, so select these first. Items left "To select" after the deadline default to Raw Development standard.</div>`;
  }
  if (!room.repeat && room.intro) html += `<p class="intro">${esc(room.intro)}</p>`;
  if (room.repeat) {
    const list = job.reps[room.id];
    if (!list.find((i) => i.id === ui.cur[room.id])) ui.cur[room.id] = list[0].id;
    inst = list.find((i) => i.id === ui.cur[room.id]);
    html += `<p class="intro">${esc(room.intro)}</p>`;
    html += `<div class="inst-bar" role="tablist">` + list.map((i) =>
      `<button type="button" class="inst" role="tab" data-inst="${i.id}" aria-current="${i.id === inst.id}">${esc(i.name || room.one)}</button>`).join('') +
      `<button type="button" class="inst add" data-add="${room.id}">+ Add ${esc(room.one.toLowerCase())}</button></div>`;
    html += `<div class="inst-tools"><label for="instName">${esc(room.one)} name</label>
      <input id="instName" data-rename="${room.id}" value="${esc(inst.name)}" placeholder="e.g. ${esc(room.defaults[0])}">
      <button type="button" class="link" data-dup="${room.id}">Duplicate this ${esc(room.one.toLowerCase())}</button>
      ${list.length > 1 ? `<button type="button" class="link danger" data-del="${room.id}">Remove</button>` : ''}</div>`;
  }
  const scope = scopeOf(room, inst && inst.id);
  const d = bag(scope);
  if (room.id === 'review') {
    html += `<div class="notice">Selections may affect cabinet openings, plumbing, electrical locations, venting, and installation. Please provide product specification sheets before rough work and cabinet fabrication are finalized. Items left "To select" after the room deadline default to Raw Development standard, and changes after sign-off are priced as change orders.</div>`;
    html += openItemsHTML(openItems());
  }
  room.sections.forEach((sec) => {
    html += `<fieldset><legend>${esc(sec.title)}</legend>` + sec.fields.map((f) => fieldHTML(f, sec, d)).join('');
    if (room.id === 'project') {
      html += `<div class="row"><div class="lbl">Rooms in this house<em>Adds a page for each one</em></div><div><div class="setup">` +
        ['bath', 'bed'].map((id) => { const r = ROOMS.find((x) => x.id === id);
          return `<div class="stepper"><b>${r.name}</b><span class="ctl"><button type="button" data-step="${id}" data-dir="-1" aria-label="Fewer ${r.name.toLowerCase()}">−</button><output>${job.reps[id].length}</output><button type="button" data-step="${id}" data-dir="1" aria-label="More ${r.name.toLowerCase()}">+</button></span></div>`; }).join('') +
        `</div><p class="msg" id="stepMsg"></p></div></div>`;
    }
    html += `</fieldset>`;
  });
  if (room.id === 'review') html += signoffHTML() + sendHTML();
  const prev = ALL[idx - 1], next = ALL[idx + 1];
  html += `<div class="foot-nav">${prev ? `<button class="btn" type="button" data-room="${prev.id}">Back: ${esc(prev.name)}</button>` : '<span></span>'}
    ${next ? `<button class="btn" type="button" data-room="${next.id}">Next: ${esc(next.name)}</button>` : `<button class="btn" type="button" data-print>Print selections</button>`}</div>`;
  main.innerHTML = html;
  main.dataset.scope = scope;
  main.querySelectorAll('textarea.txt').forEach(autosize);
  stale = false;
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(38, t.scrollHeight + 2) + 'px'; }
function render() { renderNav(); renderRoom(); }
function updateHead() {
  const room = ALL.find((r) => r.id === ui.room); if (!room) return;
  const [d, t] = countRoom(room), p = main.querySelector('.room-head p'); if (p) p.textContent = `${d} of ${t} selections made`;
}

/* ---------- Events ---------- */
function goRoom(id) { showLogin = false; ui.room = id; saveUI(); render(); window.scrollTo({ top: 0 }); }
nav.addEventListener('click', (e) => { const b = e.target.closest('[data-room]'); if (b) goRoom(b.dataset.room); });
jobbar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  if (b.dataset.go === 'jobs') { ui.room = 'project'; saveUI(); render(); setTimeout(() => { const j = main.querySelector('.jobs'); if (j) j.scrollIntoView({ block: 'start' }); }, 0); }
  else goRoom('review');
});

let armed = null;
function arm(t, label, key) {
  if (armed === key) { armed = null; return true; }
  armed = key; const old = t.textContent; t.classList.add('armed'); t.textContent = label;
  setTimeout(() => { if (armed === key) armed = null; if (t.isConnected) { t.classList.remove('armed'); t.textContent = old; } }, 3500);
  return false;
}
const msgEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text || ''; };

main.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const scope = main.dataset.scope;
  if (t.id === 'mailBtn') { t.href = mailtoHref(); return; }
  if (t.dataset.room) return goRoom(t.dataset.room);
  if (t.hasAttribute('data-print')) return doPrint();
  if (t.id === 'dlBtn') return doDownload();
  if (t.id === 'signBtn') return doSign();
  if (t.id === 'submitBtn') return doSubmit(t);
  if (t.id === 'loginBtn') return doLogin();
  if (t.id === 'cancelLogin') { showLogin = false; return render(); }
  if (t.id === 'signOutBtn') return signOut();
  if (t.id === 'copyLink') {
    const inp = document.getElementById('shareUrl');
    try { await navigator.clipboard.writeText(inp.value); msgEl('shareMsg', 'Link copied.'); } catch (err) { inp.select(); msgEl('shareMsg', 'Press Ctrl+C or Cmd+C to copy.'); }
    return;
  }
  if (t.id === 'newLink') {
    if (!arm(t, 'Tap again: the old link stops working', 'newlink')) return;
    try { const r = await api('/api/jobs/' + jobId + '/link', { method: 'POST' }); applyServerJob(r.job, true); render(); msgEl('shareMsg', 'New link made. The old one no longer works.'); }
    catch (err) { msgEl('shareMsg', err.message); }
    return;
  }
  if (t.id === 'archiveBtn') {
    try { const r = await api('/api/jobs/' + jobId + '/archive', { method: 'POST', body: { archived: !jobArchived } }); applyServerJob(r.job, true); await loadJobs(); render(); }
    catch (err) { msgEl('shareMsg', err.message); }
    return;
  }
  if (t.dataset.jump !== undefined) {
    const [room, inst, key] = t.dataset.jump.split('|');
    ui.room = room; if (inst) ui.cur[room] = inst; saveUI(); render();
    const row = main.querySelector(`[data-row="${CSS.escape(key)}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600); }
    return;
  }
  if (t.dataset.job) return openJob(t.dataset.job);
  if (t.dataset.newjob) return newJob(t.dataset.newjob === 'local');
  if (t.dataset.deljob) {
    if (!arm(t, 'Tap again to delete', 'job:' + t.dataset.deljob)) return;
    try { await api('/api/jobs/' + t.dataset.deljob, { method: 'DELETE' }); await loadJobs(); render(); } catch (err) { msgEl('jobMsg', 'Could not delete that job.'); }
    return;
  }
  if (t.dataset.o !== undefined) {
    const d = bag(scope), k = t.dataset.f, o = t.dataset.o;
    let v = (d[k] || []).slice();
    if (t.dataset.m === '1') v = v.includes(o) ? v.filter((x) => x !== o) : [...v, o];
    else v = v.includes(o) ? [] : [o];
    setField(scope, k, v);
    if (!v.some((x) => x.startsWith('Other')) && d[k + '#o']) setField(scope, k + '#o', null);
    const room = ALL.find((r) => r.id === ui.room), [sk, fk] = k.split('/');
    const sec = room.sections.find((s) => s.key === sk), f = sec.fields.find((x) => x.key === fk);
    main.querySelector(`[data-row="${CSS.escape(k)}"]`).outerHTML = fieldHTML(f, sec, d);
    const inp = main.querySelector(`[data-row="${CSS.escape(k)}"] input.other`);
    if (inp && o.startsWith('Other') && v.includes(o)) inp.focus();
    renderNav(); updateHead(); return;
  }
  if (t.dataset.inst) { ui.cur[ui.room] = t.dataset.inst; saveUI(); renderRoom(); return; }
  if (t.dataset.add) { addInst(t.dataset.add, false); return; }
  if (t.dataset.dup) { addInst(t.dataset.dup, true); return; }
  if (t.dataset.del) {
    if (!arm(t, 'Tap again to remove', 'del')) return;
    const id = t.dataset.del, list = job.reps[id];
    const i = list.findIndex((x) => x.id === ui.cur[id]);
    const sc = id + ':' + list[i].id; delete job.data[sc];
    list.splice(i, 1); ui.cur[id] = list[Math.max(0, i - 1)].id; saveUI();
    persist({ reps: job.reps, data: { [sc]: null } }); render(); return;
  }
  if (t.dataset.step) {
    const id = t.dataset.step, list = job.reps[id], r = ROOMS.find((x) => x.id === id), msg = document.getElementById('stepMsg');
    if (t.dataset.dir === '1') { list.push({ id: uid(), name: `${r.one} ${list.length + 1}` }); msg.textContent = ''; }
    else {
      if (list.length <= 1) return;
      const last = list[list.length - 1], [dn] = countScope(r, id + ':' + last.id);
      if (dn) { msg.textContent = `"${last.name}" already has selections. Remove it from the ${r.name} page if you're sure.`; return; }
      list.pop(); delete job.data[id + ':' + last.id]; msg.textContent = '';
    }
    persistReps(); renderNav(); t.closest('.ctl').querySelector('output').textContent = list.length; return;
  }
});
function addInst(id, copy) {
  const r = ROOMS.find((x) => x.id === id), list = job.reps[id];
  const src = list.find((i) => i.id === ui.cur[id]);
  const n = { id: uid(), name: copy ? `${src.name} (copy)` : `${r.one} ${list.length + 1}` };
  list.push(n);
  const p = { reps: job.reps };
  if (copy) { job.data[id + ':' + n.id] = clone(job.data[id + ':' + src.id]); p.data = { [id + ':' + n.id]: job.data[id + ':' + n.id] }; }
  persist(p);
  ui.cur[id] = n.id; saveUI(); render();
  const nm = document.getElementById('instName'); if (nm) { nm.focus(); nm.select(); }
}
main.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.rename) {
    const inst = job.reps[t.dataset.rename].find((i) => i.id === ui.cur[t.dataset.rename]); inst.name = t.value;
    const tab = main.querySelector(`.inst[data-inst="${inst.id}"]`); if (tab) tab.textContent = t.value || ROOMS.find((r) => r.id === t.dataset.rename).one;
    persistReps(); return;
  }
  if (t.dataset.f) {
    setField(main.dataset.scope, t.dataset.f, t.value);
    if (t.tagName === 'TEXTAREA') autosize(t);
    renderNav(); updateHead();
  }
});
main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pw') doLogin(); });
main.addEventListener('focusout', (e) => {
  if (e.target.dataset.rename) renderNav();
  setTimeout(() => { if (stale && !main.contains(document.activeElement)) render(); }, 0);
});

resetBtn.addEventListener('click', () => {
  if (mode !== 'local') return;
  if (!arm(resetBtn, 'Tap again to clear everything', 'reset')) return;
  resetBtn.textContent = 'Clear all';
  job = localJob = freshJob(); ui.cur = {}; ui.room = 'project'; saveUI(); saveLocal(); render();
});
builderBtn.addEventListener('click', () => {
  if (mode === 'builder') { jobId = null; ui.lastJob = null; saveUI(); render(); window.scrollTo({ top: 0 }); return; }
  showLogin = true; renderRoom(); window.scrollTo({ top: 0 });
});
document.getElementById('printBtn').addEventListener('click', doPrint);
document.getElementById('sendTop').addEventListener('click', () => { goRoom('review'); const b = document.getElementById('sendBox'); if (b) b.scrollIntoView({ block: 'start' }); });

/* ---------- Sign-off and sending ---------- */
function doSign() {
  const inp = document.getElementById('signName'), name = (inp.value || '').trim();
  if (name.length < 3) { inp.focus(); inp.placeholder = 'Type your full name first'; return; }
  const st = status();
  job.signoffs.push({ v: st.next, name, at: Date.now(), open: openItems().length, hash: '' });
  job.signoffs[job.signoffs.length - 1].hash = S.hashJob(job);
  persist({ signoffs: job.signoffs }); render();
}
async function doSubmit(btn) {
  const name = (document.getElementById('sendName').value || '').trim(), note = (document.getElementById('sendNote').value || '').trim();
  btn.disabled = true; msgEl('sendMsg', 'Sending…');
  try {
    if (pending) { clearTimeout(flushTimer); flushTimer = null; await flush(); }
    const r = await api('/api/share/' + encodeURIComponent(shareToken) + '/submit', { method: 'POST', body: { name, note } });
    applyServerJob(r.job, true); render();
    const d = r.delivered || [];
    msgEl('sendMsg', d.includes('email') ? 'Sent. Raw Development has your selections by email.' : 'Sent. Raw Development can see your selections now.');
  } catch (e) { btn.disabled = false; msgEl('sendMsg', e.message || 'Could not send. Check your connection and try again.'); }
}
function mailtoHref() {
  let body = S.summaryText(job, true);
  const LIMIT = 7000;
  if (body.length > LIMIT) body = S.summaryText(job, false) + '\nThe full selection list is too long for one email. Please see the attached summary file or PDF.\n';
  msgEl('sendMsg', body.includes('too long for one email') ? 'This email includes the job details and open items. Attach the downloaded summary file or PDF for the full list.' : '');
  return `mailto:${mode === 'builder' ? '' : config.builderEmail}?subject=${encodeURIComponent(S.subjectLine(job))}&body=${encodeURIComponent(body)}`;
}
function doPrint() { document.getElementById('print').innerHTML = S.summaryHTML(job, { builderEmail: config.builderEmail }); window.print(); }
function doDownload() {
  const mt = metaOf(), st = status();
  const name = `Selections - ${[mt.client, mt.address].filter(Boolean).join(' - ') || 'New build'} - ${st.signed ? 'v' + st.last.v : 'draft'}.html`.replace(/[\\/:*?"<>|]/g, '');
  const blob = new Blob([S.summaryDoc(job, { builderEmail: config.builderEmail })], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  msgEl('sendMsg', 'Summary file downloaded.');
}

/* ---------- Builder: sign in and jobs ---------- */
async function doLogin() {
  const pw = document.getElementById('pw'), password = pw.value;
  msgEl('loginMsg', 'Signing in…');
  try {
    const r = await fetch('/api/builder/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { msgEl('loginMsg', b.error || 'Could not sign in.'); return; }
    session = b.token; try { localStorage.setItem(BKEY, session); } catch (e) {}
    showLogin = false;
    await startBuilder();
  } catch (e) { msgEl('loginMsg', 'Could not reach the server.'); }
}
async function signOut(why) {
  const t = session; session = null; try { localStorage.removeItem(BKEY); } catch (e) {}
  if (t) { try { await fetch('/api/builder/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t } }); } catch (e) {} }
  clearInterval(pollTimer); mode = 'local'; jobId = null; pending = null; job = localJob;
  builderBtn.textContent = 'Builder sign in'; resetBtn.hidden = false;
  showLogin = !!why; render(); if (why) msgEl('loginMsg', why);
  setSave('Saved on this device only');
}
async function loadJobs() { const r = await api('/api/jobs'); jobsList = r.jobs; jobsLoaded = true; }
async function openJob(id) {
  if (pending) await flush();
  try { const r = await api('/api/jobs/' + id); jobId = id; ui.lastJob = id; ui.cur = {}; ui.room = 'project'; saveUI(); pending = null; job = freshJob(); applyServerJob(r.job, true); }
  catch (e) { msgEl('jobMsg', e.message); return; }
  render(); window.scrollTo({ top: 0 }); setSave('Saved to job record'); startPolling();
}
function closeJob(why) {
  clearInterval(pollTimer);
  if (mode === 'client') { main.innerHTML = `<div class="room-head"><h2>This link is not active</h2></div><div class="notice">${esc(why || 'Ask Raw Development for a new link.')}</div>`; nav.innerHTML = ''; jobbar.innerHTML = ''; setSave(''); return; }
  jobId = null; ui.lastJob = null; saveUI(); job = freshJob(); render();
  if (why) msgEl('jobMsg', why);
}
async function newJob(fromLocal) {
  const seed = fromLocal ? { data: localJob.data, reps: localJob.reps } : null;
  try { const r = await api('/api/jobs', { method: 'POST', body: { from: seed } }); await loadJobs(); await openJob(r.job.id); }
  catch (e) { msgEl('jobMsg', e.message); }
}
async function startBuilder() {
  mode = 'builder'; job = freshJob(); resetBtn.hidden = true; builderBtn.textContent = 'All jobs';
  setSave('Signed in as builder');
  try { await loadJobs(); } catch (e) { if (e.status === 401) return signOut('Your builder sign-in expired. Sign in again.'); }
  if (ui.lastJob && jobsList.some((j) => j.id === ui.lastJob)) return openJob(ui.lastJob);
  render();
}
async function startClient() {
  mode = 'client'; resetBtn.hidden = true; builderBtn.hidden = true;
  setSave('Loading your selections…');
  try { const r = await api('/api/share/' + encodeURIComponent(shareToken)); jobId = r.job.id; job = freshJob(); applyServerJob(r.job, true); }
  catch (e) { closeJob(e.message); return; }
  if (ui.lastJob !== jobId) { ui.cur = {}; ui.room = 'project'; ui.lastJob = jobId; saveUI(); }
  render(); setSave('Saved to Raw Development'); startPolling();
}

/* ---------- Start ---------- */
(async function start() {
  try { config = Object.assign(config, await api('/api/config')); } catch (e) {}
  if (!config.builderLogin) builderBtn.hidden = true;
  if (shareToken) return startClient();
  if (session) {
    try { await api('/api/builder/me'); return startBuilder(); }
    catch (e) { session = null; try { localStorage.removeItem(BKEY); } catch (err) {} }
  }
  render(); setSave('Saved on this device only'); resetBtn.hidden = false;
})();
})();
