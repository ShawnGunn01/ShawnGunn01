// AI Drafting Engine
// -------------------
// Every automated touch is drafted here, then lands in the owner's review
// queue — nothing in this module sends anything. Owners edit/personalize
// and send from their own inbox (see README "What's real vs. what's stubbed").
//
// This is currently template-based, not an LLM call. To wire it to a real
// model, replace the body of `draft()` with an API call that returns
// { subject, body } — everything upstream (engine.js, the review queue,
// compliance footer) stays the same.

function unsubscribeFooter(accountId) {
  return `\n\n---\nDon't want these emails? Opt out any time: {{UNSUBSCRIBE_URL}}/${accountId}`;
}

const WIN_BACK_TEMPLATES = {
  warm_up: (account) => ({
    subject: `Thinking of you, ${account.contactName || account.name}`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `It's been a little while since we last worked together at ${account.name}, and your event ` +
      `anniversary is coming up. No ask here — just wanted to say hello and let you know we'd love ` +
      `to help again whenever the timing is right.\n\n` +
      `Warmly,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
  soft_ask: (account) => ({
    subject: `Ready to plan your next event, ${account.contactName || account.name}?`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `Your event date is coming up again and I wanted to check in — would you like to get something ` +
      `on the calendar? Happy to pick up right where we left off.\n\n` +
      `Grab a time here if that's easiest: {{OWNER_CALENDLY_LINK}}\n\n` +
      `Best,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
  incentive: (account) => ({
    subject: `A little something to welcome you back`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `I know things get busy — if it's helpful, we'd love to offer ${account.incentivePct || 10}% off ` +
      `if you book within the next couple weeks. No pressure either way, just wanted you to have the option.\n\n` +
      `Book here: {{OWNER_CALENDLY_LINK}}\n\n` +
      `Best,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
};

const PROPOSAL_TEMPLATES = {
  check_in: (account) => ({
    subject: `Checking in on your proposal`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `Just wanted to check in on the proposal we sent — happy to answer any questions or make changes.\n\n` +
      `Best,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
  diy_fallback: (account) => ({
    subject: `A lower-lift option, if that's more your speed`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `No pressure on the full-service proposal — if a lighter-touch option works better for now, we also ` +
      `offer a DIY package starting at $4,500 that gives you the core essentials with less coordination on ` +
      `our end. Either path works for us, just let me know what fits.\n\n` +
      `Best,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
  final_anchor: (account) => ({
    subject: `Your event date is coming up`,
    body:
      `Hi ${account.contactName || 'there'},\n\n` +
      `Your event date is getting close, so I wanted to make sure we didn't lose the window if you'd like ` +
      `to move forward — full-service or DIY, whichever fits best right now.\n\n` +
      `Best,\n{{OWNER_NAME}}` +
      unsubscribeFooter(account.id),
  }),
};

const NURTURE_TEMPLATE = (account) => ({
  subject: `Checking in from ${'{{ORG_NAME}}'}`,
  body:
    `Hi ${account.contactName || 'there'},\n\n` +
    `No news to report — just staying in touch. Let us know if there's ever anything we can help with.\n\n` +
    `Best,\n{{OWNER_NAME}}` +
    unsubscribeFooter(account.id),
});

const ESCALATION_CALL_SCRIPT = (account) => ({
  subject: `[Personal outreach] ${account.name} — at risk, no reply after Incentive`,
  body:
    `${account.contactName || account.name} hasn't replied after the warm-up, soft ask, and incentive touches. ` +
    `This account is now flagged at-risk — reach out personally by call or text rather than another email.\n\n` +
    `Account: ${account.name}\nContact: ${account.contactName || '—'} ${account.contactEmail ? `<${account.contactEmail}>` : ''}`,
});

function draftWinBack(stage, account) {
  if (stage === 'escalation') return { ...ESCALATION_CALL_SCRIPT(account), kind: 'call_flag' };
  return { ...WIN_BACK_TEMPLATES[stage](account), kind: 'email' };
}

function draftProposalFollowUp(stage, account) {
  return { ...PROPOSAL_TEMPLATES[stage](account), kind: 'email' };
}

function draftNurture(account) {
  return { ...NURTURE_TEMPLATE(account), kind: 'email' };
}

module.exports = { draftWinBack, draftProposalFollowUp, draftNurture };
