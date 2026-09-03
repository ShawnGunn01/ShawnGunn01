// Token interpolation for drafted touches.
// -----------------------------------------
// Templates in drafts.js embed {{OWNER_NAME}}, {{OWNER_CALENDLY_LINK}},
// {{UNSUBSCRIBE_URL}}/<accountId>, and {{ORG_NAME}} as literal tokens.
// This is the one place those get resolved to real values, BEFORE a draft
// is validated (src/guardrails.js) or persisted — a validator checking for
// "a working Calendly link" is meaningless if the link is still a raw
// template token instead of a real URL.

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const ORG_NAME = 'Impact4Good';

function interpolateText(text, { ownerName, ownerCalendlyLink }) {
  if (!text) return text;
  return text
    .replace(/\{\{OWNER_NAME\}\}/g, ownerName || '')
    .replace(/\{\{OWNER_CALENDLY_LINK\}\}/g, ownerCalendlyLink || '')
    .replace(/\{\{UNSUBSCRIBE_URL\}\}\/([\w-]+)/g, (_, id) => `${APP_BASE_URL}/api/unsubscribe/${id}`)
    .replace(/\{\{ORG_NAME\}\}/g, ORG_NAME);
}

// draft: { subject, body, kind, draftSource, ... } as returned by drafts.js
// owner: the owner record (may be undefined if ownerId is stale/unknown —
// interpolation then leaves the token unresolved, which the required-
// elements guardrail is specifically built to catch, not paper over).
function interpolateDraft(draft, owner) {
  const ctx = { ownerName: owner && owner.name, ownerCalendlyLink: owner && owner.calendlyLink };
  return {
    ...draft,
    subject: interpolateText(draft.subject, ctx),
    body: interpolateText(draft.body, ctx),
  };
}

module.exports = { interpolateText, interpolateDraft, APP_BASE_URL, ORG_NAME };
