// Cohort + Timing Engine
// ----------------------
// Pure(ish) logic that decides, for every account, which funnel/stage it
// should be in right now, and whether a new touch is due. This is meant to
// be called by POST /api/engine/run — in production that call is made by
// Make.com on the "nightly + event-triggered" schedule described in the
// architecture; nothing here sends anything, it only drafts touches into
// the owner review queue.
//
// See README "Cohort & timing rules" for the plain-language spec this
// implements, and the inline comments below for the handful of judgment
// calls the spec left implicit (documented so they're easy to revisit).

const store = require('./store');
const drafts = require('./drafts');
const { interpolateDraft } = require('./interpolate');
const { validateDraft } = require('./guardrails');
const { todayStr, daysSince, daysUntil, addDays, businessDaysSince, inRange } = require('./dates');

const WIN_BACK_STAGE_ORDER = ['dormant', 'warm_up', 'soft_ask', 'incentive', 'escalation'];

function isWinBackEligible(account) {
  const hasBookedFutureEvent = account.eventBookedDate && daysUntil(account.eventBookedDate) >= 0;
  return (
    !account.optedOut &&
    daysSince(account.lastPurchaseDate) <= 365 &&
    !hasBookedFutureEvent &&
    daysSince(account.lastTouchDate) > 60
  );
}

function labelize(stage) {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function targetWinBackStage(account) {
  const anniversary = account.eventAnniversaryDate || addDays(account.lastPurchaseDate || todayStr(), 365);
  const du = daysUntil(anniversary);
  if (inRange(du, 60, 90)) return 'warm_up';
  if (inRange(du, 30, 45)) return 'soft_ask';
  if (inRange(du, 14, 21)) return 'incentive';
  if (inRange(du, 0, 7)) return 'escalation';
  return null;
}

// Incentive/Escalation only fire if the prior ask went unanswered — a reply
// means the account is in a live conversation, and the automated sequence
// should stand down rather than pile on.
function priorStageWasReplied(accountId, funnel, priorStage) {
  const prior = store.lastTouchForStage(accountId, funnel, priorStage);
  return !!prior && prior.status === 'replied';
}

// The drafting engine's quality gate. Generates via drafts.js, resolves
// {{tokens}} to real values (interpolate.js), then runs both guardrail
// layers (guardrails.js) before anything is allowed into the review queue.
// A blocked draft does NOT create a touch and does NOT advance the
// account's stage — the account is retried on the next tick rather than
// silently marked as having reached a stage it never actually got a valid
// draft for. Every attempt, pass or block, is logged in full
// (store.logDraftGeneration) for traceability.
function generateAndQueueDraft({ rawDraftFn, funnel, stage, account, allAccounts, promptInput }) {
  const rawDraft = rawDraftFn();
  const owner = store.listOwners().find((o) => o.id === account.ownerId) || null;
  const finalDraft = interpolateDraft(rawDraft, owner, account.id);
  const { valid, errors } = validateDraft(finalDraft, account, owner, allAccounts);

  store.logDraftGeneration({
    accountId: account.id,
    funnel,
    stage,
    promptInput,
    rawOutput: { subject: rawDraft.subject, body: rawDraft.body },
    finalOutput: { subject: finalDraft.subject, body: finalDraft.body },
    valid,
    errors,
  });

  if (!valid) {
    store.logActivity(
      'draft_blocked',
      account.id,
      `${labelize(stage)} draft for ${account.name} blocked by guardrails: ${errors.join('; ')}`
    );
    return { queued: false, errors };
  }

  const touch = store.createTouch({
    accountId: account.id,
    funnel,
    stage,
    subject: finalDraft.subject,
    body: finalDraft.body,
    kind: finalDraft.kind,
    draftSource: finalDraft.draftSource,
    ownerId: account.ownerId,
  });
  return { queued: true, touch };
}

// Pilot observation-window gate (Prompt 9 Item 3): while
// settings.checkpointMode is on, a stage transition that would otherwise
// draft-and-advance immediately instead gets logged as a pending
// checkpoint, and nothing else happens until an admin approves or rejects
// it (server.js POST /api/checkpoints/:id/approve|reject, which calls
// approveCheckpoint/rejectCheckpoint below). With checkpointMode off (the
// default, and the only mode that existed before this prompt) this is a
// pure pass-through — behavior is unchanged from Prompts 5-8.
function checkpointModeOn() {
  return store.getSetting('checkpointMode', false);
}

function proposeOrDraft({ funnel, stage, account, allAccounts, counts, rawDraftFn, promptInput, onQueued }) {
  if (checkpointModeOn()) {
    // A rejected checkpoint for this exact transition stays rejected —
    // see store.hasRejectedCheckpoint — until the account/stage data
    // actually changes (e.g. a corrected anniversary date shifts which
    // stage is due, which is a different checkpoint key entirely).
    if (!store.hasPendingCheckpoint(account.id, funnel, stage) && !store.hasRejectedCheckpoint(account.id, funnel, stage)) {
      store.createCheckpoint({ accountId: account.id, funnel, stage });
      store.logActivity('checkpoint_pending', account.id, `${labelize(stage)} for ${account.name} is awaiting manual checkpoint approval (pilot observation window).`);
    }
    return;
  }

  const result = generateAndQueueDraft({ rawDraftFn, funnel, stage, account, allAccounts, promptInput });
  if (result.queued) {
    onQueued();
    counts.touchesCreated += 1;
  } else {
    counts.draftsBlocked += 1;
  }
}

// Runs the actual draft-and-advance for one approved checkpoint. Shared
// with the normal (non-checkpoint) path via the same generateAndQueueDraft
// gate — a checkpoint approval is never a shortcut around the drafting
// engine's own quality guardrails, only around the automatic-stage-advance
// decision.
function draftForApprovedCheckpoint(checkpoint) {
  const account = store.getAccount(checkpoint.accountId);
  if (!account) throw new Error('Account not found');
  const allAccounts = store.listAccounts();

  const rawDraftFn =
    checkpoint.funnel === 'win_back'
      ? () => drafts.draftWinBack(checkpoint.stage, account)
      : checkpoint.funnel === 'proposal_follow_up'
      ? () => drafts.draftProposalFollowUp(checkpoint.stage, account)
      : () => drafts.draftNurture(account);
  const promptInput = { name: account.name, contactName: account.contactName, ownerId: account.ownerId, proposal: account.proposal, eventAnniversaryDate: account.eventAnniversaryDate };

  const result = generateAndQueueDraft({ rawDraftFn, funnel: checkpoint.funnel, stage: checkpoint.stage, account, allAccounts, promptInput });
  if (result.queued) {
    store.updateAccount(account.id, { stage: checkpoint.stage, stageEnteredDate: todayStr() });
    store.logActivity('touch_drafted', account.id, `${labelize(checkpoint.stage)} drafted for ${account.name} (checkpoint approved)`);
  }
  return result;
}

function approveCheckpoint(checkpointId, decidedBy) {
  const checkpoint = store.getCheckpoint(checkpointId);
  if (!checkpoint) throw new Error('Checkpoint not found');
  if (checkpoint.status !== 'pending') throw new Error(`Checkpoint is already ${checkpoint.status}`);

  const result = draftForApprovedCheckpoint(checkpoint);
  store.resolveCheckpoint(checkpointId, { status: 'approved', decidedBy });
  return result;
}

function rejectCheckpoint(checkpointId, decidedBy, reason) {
  const checkpoint = store.getCheckpoint(checkpointId);
  if (!checkpoint) throw new Error('Checkpoint not found');
  if (checkpoint.status !== 'pending') throw new Error(`Checkpoint is already ${checkpoint.status}`);

  store.resolveCheckpoint(checkpointId, { status: 'rejected', decidedBy, reason });
  store.logActivity('checkpoint_rejected', checkpoint.accountId, `${labelize(checkpoint.stage)} checkpoint rejected by ${decidedBy}${reason ? `: ${reason}` : ''}`);
}

function advanceWinBack(account, counts, allAccounts) {
  const target = targetWinBackStage(account);

  if (target && target !== account.stage && !store.hasTouchForStage(account.id, 'win_back', target)) {
    const gatingPriorStage = target === 'incentive' ? 'soft_ask' : target === 'escalation' ? 'incentive' : null;
    const stoodDown = gatingPriorStage && priorStageWasReplied(account.id, 'win_back', gatingPriorStage);

    if (!stoodDown) {
      proposeOrDraft({
        funnel: 'win_back',
        stage: target,
        account,
        allAccounts,
        counts,
        rawDraftFn: () => drafts.draftWinBack(target, account),
        promptInput: { name: account.name, contactName: account.contactName, ownerId: account.ownerId, eventAnniversaryDate: account.eventAnniversaryDate },
        onQueued: () => {
          store.updateAccount(account.id, { stage: target, stageEnteredDate: todayStr() });
          store.logActivity('touch_drafted', account.id, `${labelize(target)} drafted for ${account.name}`);
          counts.accountsAdvanced += 1;
        },
      });
    }
  }

  // Exit without converting: anniversary has passed, escalation didn't land a reply/rebook.
  const anniversary = account.eventAnniversaryDate || addDays(account.lastPurchaseDate || todayStr(), 365);
  if (daysUntil(anniversary) < 0 && account.stage === 'escalation') {
    const escTouch = store.lastTouchForStage(account.id, 'win_back', 'escalation');
    if (!escTouch || escTouch.status !== 'replied') {
      store.updateAccount(account.id, { funnel: 'nurture', stage: 'nurture', stageEnteredDate: todayStr() });
      store.logActivity('exited_to_nurture', account.id, `${account.name} exited Win-Back without converting`);
    }
  }
}

const NURTURE_INTERVAL_DAYS = 90;

function maybeNurtureTouch(account, counts, allAccounts) {
  if (daysSince(account.lastTouchDate) < NURTURE_INTERVAL_DAYS) return;
  const touches = store.listTouches().filter((t) => t.accountId === account.id && t.funnel === 'nurture');
  const recent = touches.some((t) => daysSince(t.createdAt.slice(0, 10)) < NURTURE_INTERVAL_DAYS);
  if (recent) return;

  proposeOrDraft({
    funnel: 'nurture',
    stage: 'nurture',
    account,
    allAccounts,
    counts,
    rawDraftFn: () => drafts.draftNurture(account),
    promptInput: { name: account.name, contactName: account.contactName, ownerId: account.ownerId },
    onQueued: () => store.logActivity('touch_drafted', account.id, `Nurture check-in drafted for ${account.name}`),
  });
}

function targetProposalStage(account) {
  const { sentDate, eventDate } = account.proposal;
  if (eventDate && inRange(daysUntil(eventDate), 0, 10)) return 'final_anchor';
  const bdays = businessDaysSince(sentDate);
  if (bdays >= 7) return 'diy_fallback';
  if (bdays >= 3) return 'check_in';
  return null;
}

function advanceProposalFollowUp(account, counts, allAccounts) {
  if (account.funnel !== 'proposal_follow_up') {
    store.updateAccount(account.id, { funnel: 'proposal_follow_up', stage: 'sent', stageEnteredDate: account.proposal.sentDate || todayStr() });
    account.funnel = 'proposal_follow_up';
  }

  const target = targetProposalStage(account);
  if (target && target !== account.stage && !store.hasTouchForStage(account.id, 'proposal_follow_up', target)) {
    const stoodDown = target === 'diy_fallback' && priorStageWasReplied(account.id, 'proposal_follow_up', 'check_in');
    if (!stoodDown) {
      proposeOrDraft({
        funnel: 'proposal_follow_up',
        stage: target,
        account,
        allAccounts,
        counts,
        rawDraftFn: () => drafts.draftProposalFollowUp(target, account),
        promptInput: { name: account.name, contactName: account.contactName, ownerId: account.ownerId, proposal: account.proposal },
        onQueued: () => {
          store.updateAccount(account.id, { stage: target, stageEnteredDate: todayStr() });
          store.logActivity('touch_drafted', account.id, `${labelize(target)} drafted for ${account.name}`);
          counts.accountsAdvanced += 1;
        },
      });
    }
  }

  if (account.proposal.eventDate && daysUntil(account.proposal.eventDate) < 0 && !account.proposal.outcome) {
    // Metrics Spec gap #10: don't leave outcome null — a null outcome makes
    // this account silently vanish from the Proposal Outcomes denominator
    // instead of counting as the loss it is. expired_no_response is
    // distinct from a rep-marked 'lost' so the two are reportable separately.
    store.updateAccount(account.id, {
      funnel: 'nurture',
      stage: 'nurture',
      stageEnteredDate: todayStr(),
      proposal: { ...account.proposal, outcome: 'expired_no_response' },
    });
    store.logActivity('exited_to_nurture', account.id, `${account.name}'s proposal window closed without an outcome`);
  }
}

// Isolates one account's evaluation so a bad record can't take down the
// whole tick — matches the sync layer's per-record error handling
// (Architecture v0.1 §4) applied to the engine side of the pipeline.
// allAccounts is threaded through to the drafting gate for the
// cross-account factual-accuracy check (guardrails.js).
function evaluateAccount(account, counts, allAccounts) {
  const hasOpenProposal = account.proposal && account.proposal.sentDate && !account.proposal.outcome;

  if (hasOpenProposal) {
    advanceProposalFollowUp(account, counts, allAccounts);
    return;
  }

  if (account.funnel === 'win_back') {
    advanceWinBack(account, counts, allAccounts);
  } else if (account.funnel === 'nurture') {
    if (isWinBackEligible(account)) {
      store.updateAccount(account.id, { funnel: 'win_back', stage: 'dormant', stageEnteredDate: todayStr() });
      store.logActivity('entered_win_back', account.id, `${account.name} re-entered Win-Back from Nurture`);
      counts.accountsAdvanced += 1;
      // Same-tick advance so a fresh entry doesn't sit a full cycle before its first due touch.
      advanceWinBack({ ...account, funnel: 'win_back', stage: 'dormant' }, counts, allAccounts);
    } else {
      maybeNurtureTouch(account, counts, allAccounts);
    }
  } else if (account.funnel === 'none' || !account.funnel) {
    if (isWinBackEligible(account)) {
      store.updateAccount(account.id, { funnel: 'win_back', stage: 'dormant', stageEnteredDate: todayStr() });
      store.logActivity('entered_win_back', account.id, `${account.name} entered Win-Back (dormant 12mo+ purchaser, no event booked)`);
      counts.accountsAdvanced += 1;
      advanceWinBack({ ...account, funnel: 'win_back', stage: 'dormant' }, counts, allAccounts);
    }
  }
}

// "Log every cohort recalculation somewhere reviewable without opening
// Make.com" — every call is recorded to engine_runs (store.logEngineRun),
// success or failure, before this returns or throws.
function runEngineTick() {
  const startedAt = new Date().toISOString();
  const counts = { touchesCreated: 0, accountsAdvanced: 0, draftsBlocked: 0 };
  const allAccounts = store.listAccounts();
  const accounts = allAccounts.filter((a) => !a.optedOut);

  try {
    for (const account of accounts) {
      try {
        evaluateAccount(account, counts, allAccounts);
      } catch (err) {
        // One malformed account (e.g. an unparseable date that slipped past
        // sync validation) is logged and skipped, not a failure of the tick.
        store.logActivity('engine_error', account.id, `Skipped ${account.name} this tick: ${err.message}`);
      }
    }
  } catch (err) {
    store.logEngineRun({ touchesCreated: counts.touchesCreated, accountsAdvanced: counts.accountsAdvanced, draftsBlocked: counts.draftsBlocked, errorMessage: err.message, startedAt });
    throw err;
  }

  store.logEngineRun({ touchesCreated: counts.touchesCreated, accountsAdvanced: counts.accountsAdvanced, draftsBlocked: counts.draftsBlocked, startedAt });
  return counts;
}

module.exports = { runEngineTick, isWinBackEligible, targetWinBackStage, targetProposalStage, WIN_BACK_STAGE_ORDER, approveCheckpoint, rejectCheckpoint };
