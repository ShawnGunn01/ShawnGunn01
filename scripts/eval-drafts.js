#!/usr/bin/env node
// Drafting Engine eval harness.
// ------------------------------
// Generates a draft for a varied set of sample accounts (every stage,
// both owners, missing-data edge cases, and one deliberately adversarial
// case), runs each through the exact same generate -> interpolate ->
// validate pipeline engine.js uses, and scores the result against a
// rubric: tone, factual accuracy, correct CTA, correct links present.
//
// Run: node scripts/eval-drafts.js
// Writes eval-results/latest.json (machine-readable) and
// eval-results/latest.md (human-readable) — the "show me the eval results
// before this goes live" deliverable. Run against a throwaway sandbox
// data dir; never touches data/*.json.

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.WINBACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winback-eval-'));

const store = require('../src/store');
const drafts = require('../src/drafts');
const { interpolateDraft } = require('../src/interpolate');
const { validateDraft, validatePressureTone, validateFactualAccuracy, validateDiscountAuthorization } = require('../src/guardrails');
const { addDays, todayStr } = require('../src/dates');

store.updateOwner('audrey', { calendlyLink: 'https://calendly.com/audrey-impact4good' });
store.updateOwner('nick', { calendlyLink: 'https://calendly.com/nick-impact4good' });

// ---------- the 19-account eval set ----------
// Covers all 8 stage/kind combinations, both owners, missing-contact-name
// and missing-contact-email edge cases, a high-value account, and one
// deliberately adversarial case (case 19) that MUST be blocked.

const CASES = [
  { label: 'Warm-Up · has contact name', funnel: 'win_back', stage: 'warm_up', account: { id: 'e1', name: 'Harborview Foundation', contactName: 'Renee Ibarra', contactEmail: 'renee@harborviewfdn.example', ownerId: 'audrey', eventAnniversaryDate: addDays(todayStr(), 75) } },
  { label: 'Soft Ask · has contact name', funnel: 'win_back', stage: 'soft_ask', account: { id: 'e2', name: 'Northgate Youth Alliance', contactName: 'Marcus Bell', contactEmail: 'marcus@northgateyouth.example', ownerId: 'nick', eventAnniversaryDate: addDays(todayStr(), 38) } },
  { label: 'Incentive · has contact name', funnel: 'win_back', stage: 'incentive', account: { id: 'e3', name: 'Bright Path Community Center', contactName: 'Dana Feldman', contactEmail: 'dana@brightpathcc.example', ownerId: 'audrey', eventAnniversaryDate: addDays(todayStr(), 18) } },
  { label: 'Escalation · has contact email', funnel: 'win_back', stage: 'escalation', account: { id: 'e4', name: 'Sunrise Family Services', contactName: 'Elena Cruz', contactEmail: 'elena@sunrisefamily.example', ownerId: 'nick', eventAnniversaryDate: addDays(todayStr(), 4) } },
  { label: 'Warm-Up · NO contact name (fallback)', funnel: 'win_back', stage: 'warm_up', account: { id: 'e5', name: 'Maple & Vine Community Kitchen', contactName: '', contactEmail: '', ownerId: 'audrey', eventAnniversaryDate: addDays(todayStr(), 82) } },
  { label: 'Soft Ask · NO contact email', funnel: 'win_back', stage: 'soft_ask', account: { id: 'e6', name: 'Cedar Ridge Arts Collective', contactName: 'Priya Shah', contactEmail: '', ownerId: 'nick', eventAnniversaryDate: addDays(todayStr(), 42) } },
  { label: 'Incentive · high-value account', funnel: 'win_back', stage: 'incentive', account: { id: 'e7', name: 'Riverside Literacy Project', contactName: 'Tomas Vidal', contactEmail: 'tomas@riversideliteracy.example', ownerId: 'audrey', eventAnniversaryDate: addDays(todayStr(), 15), rebookedRevenue: 42000 } },
  { label: 'Escalation · NO contact email', funnel: 'win_back', stage: 'escalation', account: { id: 'e8', name: 'Lighthouse Youth Center', contactName: 'Omar Hassan', contactEmail: '', ownerId: 'nick', eventAnniversaryDate: addDays(todayStr(), 2) } },
  { label: 'Proposal Check-In', funnel: 'proposal_follow_up', stage: 'check_in', account: { id: 'e9', name: 'Willow Creek Sanctuary', contactName: 'Grace Kim', contactEmail: 'grace@willowcreek.example', ownerId: 'audrey', proposal: { sentDate: addDays(todayStr(), -4), eventDate: addDays(todayStr(), 60) } } },
  { label: 'Proposal DIY Fallback', funnel: 'proposal_follow_up', stage: 'diy_fallback', account: { id: 'e10', name: 'Golden Gate Outreach', contactName: 'Ben Torres', contactEmail: 'ben@goldengate.example', ownerId: 'nick', proposal: { sentDate: addDays(todayStr(), -9), eventDate: addDays(todayStr(), 50) } } },
  { label: 'Proposal Final Anchor', funnel: 'proposal_follow_up', stage: 'final_anchor', account: { id: 'e11', name: 'Pinehill Recovery Center', contactName: 'Ava Chen', contactEmail: 'ava@pinehill.example', ownerId: 'audrey', proposal: { sentDate: addDays(todayStr(), -20), eventDate: addDays(todayStr(), 5) } } },
  { label: 'Proposal Check-In · NO contact name', funnel: 'proposal_follow_up', stage: 'check_in', account: { id: 'e12', name: 'Oakview Senior Services', contactName: '', contactEmail: '', ownerId: 'nick', proposal: { sentDate: addDays(todayStr(), -3), eventDate: addDays(todayStr(), 90) } } },
  { label: 'Nurture · has contact name', funnel: 'nurture', stage: 'nurture', account: { id: 'e13', name: 'Meadowbrook Family Center', contactName: 'Lena Ford', contactEmail: 'lena@meadowbrook.example', ownerId: 'audrey' } },
  { label: 'Nurture · NO contact name', funnel: 'nurture', stage: 'nurture', account: { id: 'e14', name: 'Stonebridge Community Fund', contactName: '', contactEmail: '', ownerId: 'nick' } },
  { label: 'Warm-Up · second owner/account pair', funnel: 'win_back', stage: 'warm_up', account: { id: 'e15', name: 'Crescent Moon Wellness', contactName: 'Sofia Reyes', contactEmail: 'sofia@crescentmoon.example', ownerId: 'audrey', eventAnniversaryDate: addDays(todayStr(), 68) } },
  { label: 'Incentive · second owner/account pair', funnel: 'win_back', stage: 'incentive', account: { id: 'e16', name: 'Ironwood Veterans Support', contactName: 'Marcus Webb', contactEmail: 'marcus@ironwoodvets.example', ownerId: 'nick', eventAnniversaryDate: addDays(todayStr(), 20) } },
  { label: 'Proposal DIY Fallback · second pair', funnel: 'proposal_follow_up', stage: 'diy_fallback', account: { id: 'e17', name: 'Brightside Learning Co-op', contactName: 'Nadia Petrov', contactEmail: 'nadia@brightside.example', ownerId: 'audrey', proposal: { sentDate: addDays(todayStr(), -8), eventDate: addDays(todayStr(), 45) } } },
  { label: 'Proposal Final Anchor · second pair', funnel: 'proposal_follow_up', stage: 'final_anchor', account: { id: 'e18', name: 'Prairie Wind Alliance', contactName: 'Owen Clarke', contactEmail: 'owen@prairiewind.example', ownerId: 'nick', proposal: { sentDate: addDays(todayStr(), -25), eventDate: addDays(todayStr(), 6) } } },
  {
    label: 'ADVERSARIAL · owner has no Calendly link configured (must be blocked)',
    funnel: 'win_back',
    stage: 'soft_ask',
    account: { id: 'e19', name: 'Unconfigured Test Org', contactName: 'Jordan Lee', contactEmail: 'jordan@unconfigured.example', ownerId: 'temp_unconfigured', eventAnniversaryDate: addDays(todayStr(), 40) },
    expectBlocked: true,
  },
];

// A third owner, deliberately never given a Calendly link — proves the
// gate blocks a real configuration gap, not just synthetic bad content.
{
  const owners = store.listOwners();
  owners.push({ id: 'temp_unconfigured', name: 'Temp (Unconfigured)', email: '', calendlyLink: '', backupFor: null });
  fs.writeFileSync(path.join(process.env.WINBACK_DATA_DIR, 'owners.json'), JSON.stringify(owners, null, 2));
}

const allAccounts = CASES.map((c) => c.account);

function draftFor(funnel, stage, account) {
  if (funnel === 'win_back') return drafts.draftWinBack(stage, account);
  if (funnel === 'proposal_follow_up') return drafts.draftProposalFollowUp(stage, account);
  return drafts.draftNurture(account);
}

// ---------- rubric ----------

function scoreCTA(finalDraft, stage) {
  const body = finalDraft.body || '';
  if (finalDraft.kind === 'call_flag') {
    const noCalendly = !body.includes('calendly.com');
    const saysCallOrText = /\bcall\b|\btext\b/i.test(body);
    return { pass: noCalendly && saysCallOrText, note: noCalendly && saysCallOrText ? 'correct: call/text script, no booking link' : 'wrong CTA for an internal call script' };
  }
  const hasCalendly = body.includes('calendly.com');
  return { pass: hasCalendly, note: hasCalendly ? 'correct: booking link present' : 'missing booking CTA on a client email' };
}

function runEval() {
  const results = CASES.map((c) => {
    const owner = store.listOwners().find((o) => o.id === c.account.ownerId) || null;
    const rawDraft = draftFor(c.funnel, c.stage, c.account);
    const finalDraft = interpolateDraft(rawDraft, owner);
    const gate = validateDraft(finalDraft, c.account, owner, allAccounts);

    const toneErrors = validatePressureTone(finalDraft);
    const factErrors = [...validateFactualAccuracy(finalDraft, c.account, allAccounts), ...validateDiscountAuthorization(finalDraft)];
    const cta = scoreCTA(finalDraft, c.stage);
    const linksOk = gate.valid || gate.errors.every((e) => !e.includes('opt-out') && !e.includes('Calendly') && !e.includes('owner') && !e.includes('unresolved'));

    return {
      label: c.label,
      funnel: c.funnel,
      stage: c.stage,
      accountId: c.account.id,
      owner: c.account.ownerId,
      expectBlocked: !!c.expectBlocked,
      queued: gate.valid,
      rubric: {
        tone: toneErrors.length === 0,
        factualAccuracy: factErrors.length === 0,
        correctCTA: cta.pass,
        linksPresent: gate.errors.filter((e) => e.includes('opt-out') || e.includes('Calendly') || e.includes('unresolved')).length === 0,
      },
      guardrailErrors: gate.errors,
      subject: finalDraft.subject,
      body: finalDraft.body,
    };
  });

  return results;
}

function render(results) {
  const total = results.length;
  const rubricKeys = ['tone', 'factualAccuracy', 'correctCTA', 'linksPresent'];
  const passCounts = Object.fromEntries(rubricKeys.map((k) => [k, results.filter((r) => r.rubric[k]).length]));
  const queuedCount = results.filter((r) => r.queued).length;
  const blockedAsExpected = results.filter((r) => r.expectBlocked).every((r) => !r.queued);
  const falseBlocks = results.filter((r) => !r.expectBlocked && !r.queued);

  let md = `# Drafting Engine Eval — ${new Date().toISOString()}\n\n`;
  md += `${total} cases · ${queuedCount} queued · ${total - queuedCount} blocked · adversarial case correctly blocked: ${blockedAsExpected}\n\n`;
  md += `## Rubric pass rates\n\n`;
  for (const k of rubricKeys) md += `- **${k}**: ${passCounts[k]}/${total}\n`;
  md += `\n## Per-case results\n\n`;
  md += `| # | Case | Funnel/Stage | Owner | Queued | Tone | Facts | CTA | Links | Notes |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  results.forEach((r, i) => {
    const mark = (b) => (b ? '✅' : '❌');
    const expected = r.expectBlocked ? ' (expected)' : '';
    md += `| ${i + 1} | ${r.label} | ${r.funnel}/${r.stage} | ${r.owner} | ${mark(r.queued)}${expected} | ${mark(r.rubric.tone)} | ${mark(r.rubric.factualAccuracy)} | ${mark(r.rubric.correctCTA)} | ${mark(r.rubric.linksPresent)} | ${r.guardrailErrors.join('; ') || '—'} |\n`;
  });

  if (falseBlocks.length > 0) {
    md += `\n## ⚠️ Unexpected blocks (not flagged adversarial, but got blocked)\n\n`;
    for (const r of falseBlocks) md += `- ${r.label}: ${r.guardrailErrors.join('; ')}\n`;
  }

  md += `\n## Full drafts (queued cases only)\n\n`;
  for (const r of results.filter((r) => r.queued)) {
    md += `### ${r.label}\n\n**Subject:** ${r.subject || '(none — call/text script)'}\n\n\`\`\`\n${r.body}\n\`\`\`\n\n`;
  }

  return md;
}

const results = runEval();
const outDir = path.join(__dirname, '..', 'eval-results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(outDir, 'latest.md'), render(results));

// console summary
const total = results.length;
const queued = results.filter((r) => r.queued).length;
console.log(`Eval complete: ${total} cases, ${queued} queued, ${total - queued} blocked.`);
for (const k of ['tone', 'factualAccuracy', 'correctCTA', 'linksPresent']) {
  const pass = results.filter((r) => r.rubric[k]).length;
  console.log(`  ${k}: ${pass}/${total}`);
}
const adversarial = results.find((r) => r.expectBlocked);
console.log(`Adversarial case ("${adversarial.label}") blocked as expected: ${!adversarial.queued}`);
const unexpectedBlocks = results.filter((r) => !r.expectBlocked && !r.queued);
console.log(`Unexpected blocks: ${unexpectedBlocks.length}`);
console.log(`Full report: eval-results/latest.md`);

fs.rmSync(process.env.WINBACK_DATA_DIR, { recursive: true, force: true });
