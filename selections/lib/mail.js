'use strict';
// Delivers a "Send to builder" submission. Email when SMTP is configured, a JSON
// webhook when SUBMIT_WEBHOOK_URL is set, and always the server log. Returns a
// list of the channels that succeeded so the client can say what happened.
const SUMMARY = require('../public/summary');

function config(env = process.env) {
  return {
    builderEmail: env.BUILDER_EMAIL || 'Treese@rawdevelopment.com',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined, from: env.SMTP_FROM || env.SMTP_USER } : null,
    webhook: env.SUBMIT_WEBHOOK_URL || '',
  };
}

function buildMessage(job, sub, cfg) {
  const link = cfg.publicUrl ? `${cfg.publicUrl}/?job=${encodeURIComponent(job.id)}` : '';
  const intro = `${sub.name || 'The client'} sent their selections${sub.note ? ` with this note:\n\n${sub.note}\n` : '.'}\n${link ? `Open the job: ${link}\n` : ''}\n`;
  return {
    to: cfg.builderEmail,
    subject: SUMMARY.subjectLine(job),
    text: intro + SUMMARY.summaryText(job, true),
    html: `<p>${SUMMARY.esc(intro).replace(/\n/g, '<br>')}</p>` + SUMMARY.summaryHTML(job, { builderEmail: cfg.builderEmail }),
    attachment: { filename: 'selections.html', content: SUMMARY.summaryDoc(job, { builderEmail: cfg.builderEmail }) },
  };
}

async function sendEmail(msg, cfg, transportFactory, pdf) {
  if (!cfg.smtp) return false;
  const nodemailer = require('nodemailer');
  const transport = transportFactory ? transportFactory(cfg.smtp) : nodemailer.createTransport(cfg.smtp);
  const attachments = [{ filename: msg.attachment.filename, content: msg.attachment.content, contentType: 'text/html' }];
  if (pdf) attachments.push({ filename: 'selections.pdf', content: pdf, contentType: 'application/pdf' });
  await transport.sendMail({ from: cfg.smtp.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, attachments });
  return true;
}

async function postWebhook(job, sub, msg, cfg, fetchImpl = globalThis.fetch) {
  if (!cfg.webhook) return false;
  const res = await fetchImpl(cfg.webhook, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, meta: job.meta, submission: sub, subject: msg.subject, summary: msg.text, openItems: SUMMARY.openItems(job) }) });
  if (!res.ok) throw new Error('webhook responded ' + res.status);
  return true;
}

async function deliver(job, sub, opts = {}) {
  const cfg = opts.config || config();
  const msg = buildMessage(job, sub, cfg);
  const delivered = [], errors = [];
  let pdf = null;
  if (cfg.smtp) { try { pdf = await require('./pdf').summaryPDF(job, { builderEmail: cfg.builderEmail }); } catch (e) { errors.push('pdf: ' + e.message); } }
  try { if (await sendEmail(msg, cfg, opts.transportFactory, pdf)) delivered.push('email'); } catch (e) { errors.push('email: ' + e.message); }
  try { if (await postWebhook(job, sub, msg, cfg, opts.fetch)) delivered.push('webhook'); } catch (e) { errors.push('webhook: ' + e.message); }
  (opts.log || console.log)(`[submission] job ${job.id} from ${sub.name || 'client'} -> ${delivered.join(', ') || 'saved only'}${errors.length ? ' | ' + errors.join('; ') : ''}`);
  return { delivered, errors, subject: msg.subject };
}

module.exports = { config, buildMessage, deliver };
