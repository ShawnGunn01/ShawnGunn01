// Drafting Engine — quality guardrails
// -------------------------------------
// Two independent checks, both run on every interpolated draft before it's
// allowed into the review queue:
//
//   1. validateRequiredElements — the three things every client-facing
//      draft must carry: the owner's real name/voice, a working per-owner
//      Calendly link, a working opt-out link. A call_flag (Escalation) is
//      exempt — it's an internal instruction to the owner, not a client
//      email, and carries neither a Calendly link nor an opt-out footer.
//
//   2. validateContent — a content guardrail layer, independent of #1:
//      unauthorized discounts, pressure/urgency language inconsistent with
//      the "no pressure" brand tone, and factual accuracy against the data
//      layer (cross-account contamination, a date that doesn't match any
//      field actually on this account).
//
// Both run today against deterministic template output, where they should
// almost always pass — the templates were written to comply. Their real
// job starts the day drafting engine's `draftSource` moves from 'template'
// to 'ai' (see drafts.js header): unauthored/hallucinated content is a
// generation-time risk with a live model that this layer exists to catch
// before send, so it's built and load-bearing now, not bolted on later.
// See test/guardrails.test.js for adversarial cases proving each check
// actually rejects something, not just passing template output by default.

const { INCENTIVE_PERCENT } = require('./drafts');

const PRESSURE_PHRASES = [
  /\bact now\b/i,
  /\bdon'?t miss out\b/i,
  /\blimited time\b/i,
  /\blast chance\b/i,
  /\bhurry\b/i,
  /\bexpires? (today|tonight|soon)\b/i,
  /\bfinal notice\b/i,
  /\burgent\b/i,
  /\btime is running out\b/i,
  /\bbefore it'?s too late\b/i,
  /\bonly \d+ (spots|days|hours|seats) left\b/i,
  /\bact fast\b/i,
];

function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- 1. Required elements: owner voice, Calendly link, opt-out ----------

function validateRequiredElements(draft, owner) {
  const errors = [];
  if (draft.kind === 'call_flag') return errors; // internal call/text script, not a client email

  const subject = draft.subject || '';
  const body = draft.body || '';

  // Any leftover {{TOKEN}} means interpolation didn't fully resolve —
  // whatever the specific cause, an unresolved token reaching a client
  // inbox is always a defect, so this is checked directly rather than
  // inferred from the individual checks below.
  if (/\{\{[A-Z_]+\}\}/.test(subject) || /\{\{[A-Z_]+\}\}/.test(body)) {
    errors.push('unresolved template token present — interpolation incomplete');
  }

  // Owner voice: the real owner name must actually appear (catches a
  // missing/unknown ownerId as well as a failed interpolation).
  if (!owner || !owner.name || !body.includes(owner.name)) {
    errors.push("owner's name does not appear in the draft — owner voice missing");
  }

  // Opt-out link: must be a real, well-formed URL, not just present text.
  const unsubMatch = body.match(/https?:\/\/\S+\/api\/unsubscribe\/\S+/);
  const unsubUrl = unsubMatch ? unsubMatch[0].replace(/[).,]+$/, '') : null;
  if (!unsubUrl || !isHttpUrl(unsubUrl)) {
    errors.push('missing or malformed opt-out link');
  }

  // Calendly link: must be THIS owner's real link, present verbatim and well-formed.
  const calendlyLink = owner && owner.calendlyLink;
  if (!calendlyLink || !isHttpUrl(calendlyLink) || !body.includes(calendlyLink)) {
    errors.push('missing or malformed per-owner Calendly link');
  }

  return errors;
}

// ---------- 2. Content guardrails: discount, tone, facts ----------

function validateDiscountAuthorization(draft) {
  const errors = [];
  const body = draft.body || '';
  const percentMatches = body.match(/(\d+(?:\.\d+)?)\s*%/g) || [];
  for (const match of percentMatches) {
    const value = parseFloat(match);
    if (value !== INCENTIVE_PERCENT) {
      errors.push(`unauthorized discount mentioned (${match.trim()}) — only ${INCENTIVE_PERCENT}% is authorized (PRD v0.2 §10)`);
    }
  }
  return errors;
}

function validatePressureTone(draft) {
  const errors = [];
  const text = `${draft.subject || ''} ${draft.body || ''}`;
  for (const pattern of PRESSURE_PHRASES) {
    if (pattern.test(text)) {
      errors.push(`pressure/urgency language detected ("${pattern.source}") — inconsistent with the no-pressure brand tone`);
    }
  }
  return errors;
}

// Cross-account contamination + date sanity against the account's own
// known fields. Doesn't need every possible fact checked — it needs to
// catch the two failure modes that actually matter: a name that belongs
// to a different account, and a date that doesn't correspond to anything
// this account actually has on file.
function validateFactualAccuracy(draft, account, allAccounts) {
  const errors = [];
  if (draft.kind === 'call_flag') return errors;
  const text = `${draft.subject || ''} ${draft.body || ''}`;

  const others = (allAccounts || []).filter((a) => a.id !== account.id && a.name && a.name.length > 3);
  for (const other of others) {
    if (text.includes(other.name)) {
      errors.push(`references another account's name ("${other.name}") — likely cross-contamination`);
    }
  }

  const knownDates = [
    account.eventAnniversaryDate,
    account.eventBookedDate,
    account.lastPurchaseDate,
    account.proposal && account.proposal.sentDate,
    account.proposal && account.proposal.eventDate,
  ].filter(Boolean);
  const datesInText = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  for (const d of datesInText) {
    if (!knownDates.includes(d)) {
      errors.push(`references a date (${d}) that doesn't match any known field on this account`);
    }
  }

  return errors;
}

function validateContent(draft, account, allAccounts) {
  return [
    ...validateDiscountAuthorization(draft),
    ...validatePressureTone(draft),
    ...validateFactualAccuracy(draft, account, allAccounts),
  ];
}

// Combined gate. Call this on the interpolated draft, before persisting.
function validateDraft(draft, account, owner, allAccounts) {
  const errors = [...validateRequiredElements(draft, owner), ...validateContent(draft, account, allAccounts)];
  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateRequiredElements,
  validateContent,
  validateDiscountAuthorization,
  validatePressureTone,
  validateFactualAccuracy,
  validateDraft,
  PRESSURE_PHRASES,
};
