'use strict';
// Renders the selections summary as a PDF with pdfkit: the same content as the
// HTML summary (job details, open items, pricing, every room, sign-off), laid out
// for printing and attaching to a contract. No browser involved.
const PDFDocument = require('pdfkit');
const SUMMARY = require('../public/summary');
const { FORM_REV } = require('../public/checklist');

const NAVY = '#16233f', GOLD = '#b8923a', INK = '#18202e', MUTED = '#5d6678', LINE = '#d9dde5', RED = '#b4423a';
const BASE = 9.5;

function summaryPDF(job, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 56, left: 50, right: 50 }, bufferPages: true,
      info: { Title: SUMMARY.subjectLine(job), Author: 'Raw Development Design', Subject: 'New Build Selections' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { draw(doc, job, opts); doc.end(); } catch (e) { reject(e); }
  });
}

function draw(doc, job, opts) {
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const st = SUMMARY.status(job), open = SUMMARY.openItems(job), pr = SUMMARY.pricing(job);

  const h1 = (t) => { doc.font('Helvetica-Bold').fontSize(17).fillColor(NAVY).text(t, L, doc.y, { width: W }); doc.moveDown(0.4); };
  const h2 = (t) => {
    ensure(40);
    doc.moveDown(0.9).font('Helvetica-Bold').fontSize(12.5).fillColor(NAVY).text(t, L, doc.y, { width: W });
    const y = doc.y + 2; doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1.2).strokeColor(GOLD).stroke(); doc.y = y + 6;
  };
  const h3 = (t) => { ensure(28); doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10).fillColor(INK).text(t, L, doc.y, { width: W }); doc.moveDown(0.15); };
  const para = (t, color) => { ensure(24); doc.font('Helvetica').fontSize(BASE).fillColor(color || INK).text(t, L, doc.y, { width: W }); };

  // Two-column row: bold label on the left, value on the right, never split across pages.
  const labelW = Math.round(W * 0.4), gap = 10, valueW = W - labelW - gap;
  function row(label, value, o = {}) {
    const v = value && String(value).trim() ? String(value) : (o.blank || '______________________');
    doc.font('Helvetica-Bold').fontSize(BASE); const hl = doc.heightOfString(label, { width: labelW });
    doc.font('Helvetica').fontSize(BASE); const hv = doc.heightOfString(v, { width: valueW });
    const h = Math.max(hl, hv) + 7;
    ensure(h);
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(INK).text(label, L, y + 3, { width: labelW });
    doc.font('Helvetica').fillColor(value && String(value).trim() ? INK : '#999999').text(v, L + labelW + gap, y + 3, { width: valueW });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  }
  // Fixed-width table with a header row, used for pricing and sign-off history.
  function table(cols, rows, o = {}) {
    const widths = cols.map((c) => Math.round(W * c.w));
    const line = (cells, bold, color) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(BASE);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: widths[i] - 8 }))) + 7;
      ensure(h);
      const y = doc.y; let x = L;
      cells.forEach((c, i) => {
        doc.fillColor(cols[i].color ? cols[i].color(c, rows) : (color || INK)).text(String(c), x + 4, y + 3, { width: widths[i] - 8, align: cols[i].align || 'left' });
        x += widths[i];
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    };
    line(cols.map((c) => c.title), true, MUTED);
    rows.forEach((r) => line(r.cells, !!r.bold, r.color));
  }

  h1('Raw Development Design: New Build Selections');
  SUMMARY.jobLines(job).forEach(([l, v]) => row(l, v));
  row('Selections status', st.text);
  row('Form', FORM_REV);

  h2(`Open items (${open.length})`);
  if (open.length) open.forEach((o) => row(`${o.title} > ${o.section} > ${o.label}`, o.value));
  else para('None. Every item has a selection or is not applicable.');

  if (pr.n) {
    h2('Pricing');
    const money = (v) => (v === null ? 'not set' : SUMMARY.fmtMoney(v));
    const overColor = (c) => (/^Over/.test(String(c)) ? RED : INK);
    table([{ title: 'Item', w: 0.52 }, { title: 'Allowance', w: 0.15, align: 'right' }, { title: 'Cost', w: 0.15, align: 'right' }, { title: 'Over / under', w: 0.18, align: 'right', color: overColor }],
      pr.items.map((i) => ({ cells: [`${i.title} > ${i.section} > ${i.label}${i.value ? '\n' + i.value : ''}`, money(i.allow), money(i.cost), SUMMARY.diffText(i.diff)] }))
        .concat([{ cells: ['Total', SUMMARY.fmtMoney(pr.allow), SUMMARY.fmtMoney(pr.cost), SUMMARY.diffText(pr.diff)], bold: true }]));
  }

  SUMMARY.eachScope(job, (room, scope, title) => {
    const d = job.data[scope] || {};
    h2(title);
    room.sections.forEach((sec) => {
      h3(sec.title);
      sec.fields.forEach((f) => row(f.label, SUMMARY.valueText(f, d, sec.key + '/' + f.key)));
    });
  });

  h2('Sign-off');
  if (job.signoffs.length) {
    table([{ title: 'Version', w: 0.14 }, { title: 'Signed by', w: 0.36 }, { title: 'Date', w: 0.32 }, { title: 'Open items', w: 0.18, align: 'right' }],
      job.signoffs.map((s) => ({ cells: ['v' + s.v, s.name, SUMMARY.fmtDate(s.at), String(s.open)] })));
    doc.moveDown(0.6);
  }
  para('Selections may affect cabinet openings, plumbing, electrical locations, venting, and installation. Provide product specification sheets before rough work and cabinet fabrication are finalized. Items left "To select" after the room deadline default to Raw Development standard, and changes after sign-off are priced as change orders.', MUTED);
  doc.moveDown(1);
  ensure(90);
  row('Client signature', '', { blank: '________________________________    Date ______________' });
  row('Raw Development', '', { blank: '________________________________    Date ______________' });
  row('Selections version', st.signed ? 'v' + st.last.v : 'Draft (next version v' + st.next + ')');
  row('Form', FORM_REV);

  // Footer with page numbers on every page.
  const range = doc.bufferedPageRange();
  const m = SUMMARY.metaOf(job);
  const foot = ['Raw Development Design | New Build Selections', opts.builderEmail, m.client, st.signed ? 'v' + st.last.v + ' signed' : 'Draft'].filter(Boolean).join(' | ');
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit start a new page; lift the margin while the footer goes in.
    const keep = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    const y = doc.page.height - 36;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(foot, L, y, { width: W - 70, lineBreak: false, ellipsis: true });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W - 70, y, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
}

module.exports = { summaryPDF };
