// Adversarial guardrail tests.
// -----------------------------
// The real templates (drafts.js) are hand-written to already comply, so
// running them through the guardrails mostly proves the plumbing works,
// not that the checks themselves can catch a violation. These tests feed
// deliberately bad content straight into guardrails.js to prove each check
// actually rejects what it's supposed to — the thing that matters once
// draftSource moves from 'template' to 'ai' and generation is no longer
// hand-written-compliant by construction.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRequiredElements, validateDiscountAuthorization, validatePressureTone, validateFactualAccuracy, validateDraft } = require('../src/guardrails');

const OWNER = { id: 'audrey', name: 'Audrey', calendlyLink: 'https://calendly.com/audrey-impact4good' };
const ACCOUNT = { id: 'acct_1', name: 'Harborview Foundation', contactName: 'Renee', lastPurchaseDate: '2025-10-15', eventAnniversaryDate: '2026-11-16' };
const OTHER_ACCOUNTS = [ACCOUNT, { id: 'acct_2', name: 'Northgate Youth Alliance' }, { id: 'acct_3', name: 'Bright Path Community Center' }];

function goodDraft(overrides = {}) {
  return {
    kind: 'email',
    subject: 'Ready to plan your next event, Renee?',
    body:
      `Hi Renee,\n\nWould you like to get something on the calendar? ` +
      `Grab a time here: ${OWNER.calendlyLink}\n\nBest,\n${OWNER.name}` +
      `\n\n---\nDon't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/acct_1`,
    ...overrides,
  };
}

// ---------- positive control ----------

test('A well-formed draft passes all guardrails', () => {
  const result = validateDraft(goodDraft(), ACCOUNT, OWNER, OTHER_ACCOUNTS);
  assert.equal(result.valid, true, `expected no errors, got: ${result.errors.join('; ')}`);
});

// ---------- required elements ----------

test('Blocks a draft with no Calendly link at all', () => {
  const draft = goodDraft({ body: goodDraft().body.replace(OWNER.calendlyLink, '') });
  const errors = validateRequiredElements(draft, OWNER);
  assert.ok(errors.some((e) => e.includes('Calendly')));
});

test('Blocks a draft using a DIFFERENT owner\'s Calendly link than the one assigned', () => {
  const wrongLink = 'https://calendly.com/nick-impact4good';
  const draft = goodDraft({ body: goodDraft().body.replace(OWNER.calendlyLink, wrongLink) });
  const errors = validateRequiredElements(draft, OWNER); // OWNER is still Audrey
  assert.ok(errors.some((e) => e.includes('Calendly')), 'a link that is not literally this owner\'s own link must be rejected');
});

test('Blocks a draft when the owner has no Calendly link configured yet', () => {
  const unconfiguredOwner = { id: 'audrey', name: 'Audrey', calendlyLink: '' };
  const errors = validateRequiredElements(goodDraft(), unconfiguredOwner);
  assert.ok(errors.some((e) => e.includes('Calendly')));
});

test('Blocks a draft with no opt-out link', () => {
  const draft = goodDraft({ body: 'Hi Renee,\n\nWould you like to get something on the calendar? ' + OWNER.calendlyLink + '\n\nBest,\nAudrey' });
  const errors = validateRequiredElements(draft, OWNER);
  assert.ok(errors.some((e) => e.includes('opt-out')));
});

test('Blocks a draft with a malformed opt-out link (not a real URL)', () => {
  const draft = goodDraft({ body: goodDraft().body.replace('http://localhost:3000/api/unsubscribe/acct_1', 'unsubscribe/acct_1') });
  const errors = validateRequiredElements(draft, OWNER);
  assert.ok(errors.some((e) => e.includes('opt-out')));
});

test('Blocks a draft with a leftover unresolved {{TOKEN}}', () => {
  const draft = goodDraft({ subject: 'Hi {{CONTACT_NAME}}' });
  const errors = validateRequiredElements(draft, OWNER);
  assert.ok(errors.some((e) => e.includes('unresolved')));
});

test('Blocks a draft where the owner\'s name never actually appears (voice missing)', () => {
  const draft = goodDraft({ body: goodDraft().body.replace('Best,\nAudrey', 'Best,\nThe Team') });
  const errors = validateRequiredElements(draft, OWNER);
  assert.ok(errors.some((e) => e.includes('owner') || e.includes('voice')));
});

test('call_flag (Escalation) drafts are exempt from Calendly/opt-out — not a client email', () => {
  const draft = { kind: 'call_flag', subject: 'Call Renee', body: 'Account is at-risk, no reply after Incentive. Call or text.' };
  const errors = validateRequiredElements(draft, OWNER);
  assert.deepEqual(errors, []);
});

// ---------- content guardrails ----------

test('Rejects an unauthorized discount (10% instead of the decided 5%)', () => {
  const draft = goodDraft({ body: goodDraft().body + '\n\nWe can offer 10% off if you book this week.' });
  const errors = validateDiscountAuthorization(draft);
  assert.ok(errors.some((e) => e.includes('10%')));
});

test('Allows the authorized 5% and does not false-positive on it', () => {
  const draft = goodDraft({ body: goodDraft().body + '\n\nWe can offer 5% off.' });
  const errors = validateDiscountAuthorization(draft);
  assert.deepEqual(errors, []);
});

test('Rejects pressure/urgency language inconsistent with the no-pressure tone', () => {
  const examples = [
    'Act now before this offer expires!',
    'Limited time only — don\'t miss out.',
    'This is your last chance to rebook.',
    'Hurry, only 2 spots left this month.',
  ];
  for (const line of examples) {
    const draft = goodDraft({ body: goodDraft().body + '\n\n' + line });
    const errors = validatePressureTone(draft);
    assert.ok(errors.length > 0, `expected "${line}" to trip the pressure-tone guardrail`);
  }
});

test('Does not flag ordinary, pressure-free copy', () => {
  const errors = validatePressureTone(goodDraft());
  assert.deepEqual(errors, []);
});

test('Rejects a draft that references a different account\'s name (cross-contamination)', () => {
  const draft = goodDraft({ body: goodDraft().body + '\n\nP.S. following up on Northgate Youth Alliance\'s event too.' });
  const errors = validateFactualAccuracy(draft, ACCOUNT, OTHER_ACCOUNTS);
  assert.ok(errors.some((e) => e.includes('Northgate Youth Alliance')));
});

test('Rejects a draft referencing a date that matches no known field on the account', () => {
  const draft = goodDraft({ body: goodDraft().body + '\n\nYour event on 2030-01-01 is coming up.' });
  const errors = validateFactualAccuracy(draft, ACCOUNT, OTHER_ACCOUNTS);
  assert.ok(errors.some((e) => e.includes('2030-01-01')));
});

test('Allows a date that DOES match a known account field', () => {
  const draft = goodDraft({ body: goodDraft().body + `\n\nYour anniversary (${ACCOUNT.eventAnniversaryDate}) is coming up.` });
  const errors = validateFactualAccuracy(draft, ACCOUNT, OTHER_ACCOUNTS);
  assert.deepEqual(errors, []);
});

test('A draft can fail multiple guardrails at once, and all are reported', () => {
  const draft = goodDraft({
    body: goodDraft().body.replace(OWNER.calendlyLink, '') + '\n\nAct now — only 10% off today!',
  });
  const result = validateDraft(draft, ACCOUNT, OWNER, OTHER_ACCOUNTS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2, `expected multiple errors, got: ${JSON.stringify(result.errors)}`);
});
