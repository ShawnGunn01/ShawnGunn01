// Summary, open-items and sign-off status for a job. Pure functions shared by the
// browser app (print, email, download) and the server (submission emails).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./checklist'));
  else root.SUMMARY = factory(root.CHECKLIST);
})(typeof self !== 'undefined' ? self : this, function (C) {
  const { ROOMS, OPEN_RE, FORM_REV } = C;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const scopeOf = (room, inst) => (room.repeat ? room.id + ':' + inst : room.id);
  const filled = (f, v) => (f.text ? !!(v && String(v).trim()) : !!(v && v.length));
  const fmtDate = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  function metaOf(job) {
    const p = (job.data && job.data.project) || {}, g = (k) => String(p['job-details/' + k] || '').trim();
    return { client: g('client-name'), address: g('project-address'), lot: g('lot-or-apn'), jobNo: g('job-number'), date: g('date') };
  }
  function countScope(job, room, scope) {
    let done = 0, total = 0; const d = job.data[scope] || {};
    room.sections.forEach((s) => s.fields.forEach((f) => { total++; if (filled(f, d[s.key + '/' + f.key])) done++; }));
    return [done, total];
  }
  function countRoom(job, room) {
    if (!room.repeat) return countScope(job, room, room.id);
    return (job.reps[room.id] || []).reduce((a, i) => { const [d, t] = countScope(job, room, scopeOf(room, i.id)); return [a[0] + d, a[1] + t]; }, [0, 0]);
  }
  function eachScope(job, fn) {
    ROOMS.forEach((r) => {
      if (r.repeat) (job.reps[r.id] || []).forEach((i) => fn(r, scopeOf(r, i.id), `${r.one}: ${i.name || r.one}`, i.id));
      else fn(r, r.id, r.name, null);
    });
  }
  function openItems(job) {
    const out = [];
    eachScope(job, (room, scope, title, inst) => {
      const d = job.data[scope] || {};
      room.sections.forEach((s) => s.fields.forEach((f) => {
        if (f.text) return;
        const hits = (d[s.key + '/' + f.key] || []).filter((o) => OPEN_RE.test(o));
        if (hits.length) out.push({ room: room.id, inst, title, section: s.title, label: f.label, value: hits.join(', '), key: s.key + '/' + f.key });
      }));
    });
    return out;
  }
  function unanswered(job) { let n = 0; eachScope(job, (room, scope) => { const [d, t] = countScope(job, room, scope); n += t - d; }); return n; }
  // Canonical form of the selections: sorted keys, empty values dropped. Two copies
  // of the same job (one device, the server, another device) hash the same even if
  // the browser created empty room objects while rendering.
  function canon(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach((k) => { const c = canon(v[k]); if (c === undefined) return; out[k] = c; });
      return Object.keys(out).length ? out : undefined;
    }
    if (v === null || v === undefined || v === '') return undefined;
    return v;
  }
  function hashJob(job) {
    const s = JSON.stringify({ d: canon(job.data) || {}, r: canon(job.reps) || {} }); let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function status(job) {
    const last = job.signoffs[job.signoffs.length - 1];
    if (!last) return { text: 'Draft, not signed yet', signed: false, next: 1 };
    if (last.hash === hashJob(job)) return { text: `Version ${last.v}, signed by ${last.name} on ${fmtDate(last.at)}`, signed: true, next: last.v + 1, last };
    return { text: `Draft with changes since version ${last.v} (signed ${fmtDate(last.at)})`, signed: false, next: last.v + 1, last };
  }
  function valueText(f, d, k) {
    if (f.text) return String(d[k] || '').trim();
    const v = d[k] || []; return v.map((o) => (o.startsWith('Other') && d[k + '#o'] ? `${o}: ${d[k + '#o']}` : o)).join(', ');
  }
  function jobLines(job) { const m = metaOf(job); return [['Client', m.client], ['Property address', m.address], ['Lot / APN', m.lot], ['Job #', m.jobNo], ['Date', m.date]]; }
  function subjectLine(job) {
    const m = metaOf(job), st = status(job);
    return `Selections: ${[m.client, m.address].filter(Boolean).join(', ') || 'New build'}${st.signed ? ' (v' + st.last.v + ' signed)' : ''}`;
  }
  function summaryText(job, full) {
    const st = status(job), open = openItems(job);
    let s = 'RAW DEVELOPMENT DESIGN: NEW BUILD SELECTIONS\n';
    jobLines(job).forEach(([l, v]) => { s += `${l}: ${v || '(not entered)'}\n`; });
    s += `Status: ${st.text}\n${FORM_REV}\n\nOPEN ITEMS (${open.length})\n`;
    s += open.length ? open.map((o) => `- ${o.title} > ${o.section} > ${o.label}: ${o.value}`).join('\n') : '- None';
    s += `\n\n${unanswered(job)} items not answered yet.\n`;
    if (full) {
      s += '\nSELECTIONS\n';
      eachScope(job, (room, scope, title) => {
        const d = job.data[scope] || {}; let block = '';
        room.sections.forEach((sec) => {
          const rows = sec.fields.map((f) => { const v = valueText(f, d, sec.key + '/' + f.key); return v ? `  ${f.label}: ${v}` : ''; }).filter(Boolean);
          if (rows.length) block += `${sec.title}\n${rows.join('\n')}\n`;
        });
        if (block) s += `\n== ${title.toUpperCase()} ==\n${block}`;
      });
    }
    return s;
  }
  function summaryHTML(job, opts) {
    opts = opts || {};
    const st = status(job), open = openItems(job), blank = '<span class="blank">______________________</span>';
    let h = `<h1>Raw Development Design: New Build Selections</h1><table class="jobt">` +
      jobLines(job).map(([l, v]) => `<tr><td>${l}</td><td>${v ? esc(v) : blank}</td></tr>`).join('') +
      `<tr><td>Selections status</td><td>${esc(st.text)}</td></tr><tr><td>Form</td><td>${FORM_REV}</td></tr></table>`;
    h += `<h2>Open items (${open.length})</h2>` + (open.length ? `<table>` + open.map((o) => `<tr><td>${esc(o.title)} › ${esc(o.section)} › ${esc(o.label)}</td><td>${esc(o.value)}</td></tr>`).join('') + `</table>` : '<p>None. Every item has a selection or is not applicable.</p>');
    eachScope(job, (room, scope, title) => {
      const d = job.data[scope] || {};
      h += `<h2>${esc(title)}</h2>` + room.sections.map((sec) => `<h3>${esc(sec.title)}</h3><table>` + sec.fields.map((f) => {
        const v = valueText(f, d, sec.key + '/' + f.key);
        return `<tr><td>${esc(f.label)}</td><td>${v ? esc(v) : blank}</td></tr>`;
      }).join('') + `</table>`).join('');
    });
    h += `<h2>Sign-off</h2>`;
    if (job.signoffs.length) h += `<table>` + job.signoffs.map((s) => `<tr><td>Version ${s.v}</td><td>Signed by ${esc(s.name)} on ${esc(fmtDate(s.at))} with ${s.open} open item${s.open === 1 ? '' : 's'}</td></tr>`).join('') + `</table>`;
    h += `<p>Selections may affect cabinet openings, plumbing, electrical locations, venting, and installation. Provide product specification sheets before rough work and cabinet fabrication are finalized. Items left "To select" after the room deadline default to Raw Development standard, and changes after sign-off are priced as change orders.</p>
    <table class="sig"><tr><td>Client signature</td><td>______________________________</td><td>Date</td><td>____________</td></tr>
    <tr><td>Raw Development</td><td>______________________________</td><td>Date</td><td>____________</td></tr>
    <tr><td>Selections version</td><td>${st.signed ? 'v' + st.last.v : 'Draft (next version v' + st.next + ')'}</td><td>Form</td><td>${FORM_REV}</td></tr></table>
    <p>Raw Development Design | Room Selections${opts.builderEmail ? ' | ' + esc(opts.builderEmail) : ''}</p>`;
    return h;
  }
  const DOC_CSS = 'body{font:13px/1.45 system-ui,sans-serif;color:#18202e;max-width:900px;margin:24px auto;padding:0 16px}h1{color:#16233f;font-size:22px}h2{color:#16233f;border-bottom:2px solid #b8923a;padding-bottom:3px;margin-top:22px}h3{font-size:13px;margin:10px 0 2px}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:4px 6px;vertical-align:top}td:first-child{width:40%;font-weight:600}.blank{color:#999}';
  function summaryDoc(job, opts) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(subjectLine(job))}</title><style>${DOC_CSS}</style></head><body>${summaryHTML(job, opts)}</body></html>`;
  }
  return { esc, scopeOf, filled, fmtDate, metaOf, countScope, countRoom, eachScope, openItems, unanswered, hashJob, status, valueText, jobLines, subjectLine, summaryText, summaryHTML, summaryDoc };
});
