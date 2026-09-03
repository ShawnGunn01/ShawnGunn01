// Target / kill threshold annotations — Metrics Spec v0.1.
// ----------------------------------------------------------
// Deliberately separate from dashboard.js: dashboard.js computes a metric's
// real value from the data layer, this module judges that value against
// the numbers the Metrics Spec already defined (target/kill), and returns
// a status the UI renders as a reference line. Splitting these two
// concerns is what makes "add a new metric later" a two-function edit
// instead of a rebuild — see docs, "Adding a New Metric."
//
// Every number below is transcribed from Metrics Spec v0.1, not invented
// here. Where the spec explicitly declined to set a threshold (Active
// Accounts, Repeat-Purchase Rate YoY during the pilot), that's encoded as
// status 'not_applicable' with the spec's own reasoning, rather than a
// threshold quietly made up to fill space.

const STATUS = { ON_TRACK: 'on_track', WATCH: 'watch', BELOW_KILL: 'below_kill', NOT_APPLICABLE: 'not_applicable' };

function bandStatus(value, { kill, target }) {
  if (value === null || value === undefined) return STATUS.NOT_APPLICABLE;
  if (kill !== undefined && value < kill) return STATUS.BELOW_KILL;
  if (target !== undefined && value < target) return STATUS.WATCH;
  return STATUS.ON_TRACK;
}

// Reply Rate (30d): kill <5%, pilot target >=15%. Metrics Spec §3.
function replyRate(value) {
  return {
    value,
    kill: 5,
    target: 15,
    unit: '%',
    status: bandStatus(value, { kill: 5, target: 15 }),
    note: 'Pilot target. Full rollout: hold at 15%, or raise to 18-20% once templates are finalized against Dami\'s real examples.',
  };
}

// Recovered Revenue QTD: kill zone is $3,000-5,000 after one full cycle,
// no target set on purpose (Metrics Spec §4 — a number now would be a
// guess dressed as a target until cohort size and incentive economics are
// observed for a full cycle).
function recoveredRevenue(value) {
  const status = value === null || value === undefined ? STATUS.NOT_APPLICABLE : value < 3000 ? STATUS.BELOW_KILL : value < 5000 ? STATUS.WATCH : STATUS.ON_TRACK;
  return {
    value,
    kill: 3000,
    killUpper: 5000,
    target: undefined,
    unit: '$',
    status,
    note: 'No target set on purpose until one full pilot cycle completes (Metrics Spec §4) — the $3,000-5,000 band is the kill zone, not a range to hit.',
  };
}

// Repeat-Purchase Rate YoY: not a valid pilot-phase read at all — an
// 8-week pilot can't produce a trailing-365-day comparison, and the data
// model only has forward-going purchase history (Metrics Spec §2).
function repeatPurchaseRateYoY(value) {
  return {
    value,
    kill: undefined,
    target: undefined,
    unit: '%',
    status: STATUS.NOT_APPLICABLE,
    note: 'Not measurable during an 8-week pilot regardless of data quality — use Win-Back Cohort Conversion below as the pilot-phase proxy. Full-rollout target: +8-10pts over baseline across 2 full quarters.',
  };
}

// Active Accounts in Cohort: an operational sanity check, not a
// performance metric — no target/kill is meaningful here (Metrics Spec §1).
function activeAccounts(value) {
  return { value, kill: undefined, target: undefined, unit: '', status: STATUS.NOT_APPLICABLE, note: 'Coverage check, not a performance target — expect it to track the pilot cohort size.' };
}

// Win-Back Cohort Conversion: target >=12% (Metrics Spec §7/pilot target).
// Approximated as rebooked / warmUpSent (the earliest stage nearly every
// entering account reaches) since the funnel counters aren't yet
// time-windowed per account-cohort (Architecture v0.1 flagged this same
// gap for the funnel's own bucket counts).
function winBackConversion(rebooked, warmUpSent) {
  const value = warmUpSent > 0 ? Number(((rebooked / warmUpSent) * 100).toFixed(1)) : null;
  return {
    value,
    kill: undefined,
    target: 12,
    unit: '%',
    status: value === null ? STATUS.NOT_APPLICABLE : bandStatus(value, { target: 12 }),
    note: 'Approximated as rebooked / Warm-Up Sent (not yet cohort-time-windowed — see Architecture v0.1 §4). No standalone kill number; the funnel\'s real health check is the Incentive-vs-Soft-Ask reply-rate comparison below.',
  };
}

// The funnel's actual kill CONDITION (Metrics Spec §5): the 5% incentive
// only means something if it outperforms the free Soft Ask. This is a
// relative check, not a single-number threshold, so it's shaped
// differently from the others on purpose.
function incentiveLift(softAskReplyRate, incentiveReplyRate) {
  if (softAskReplyRate === null || incentiveReplyRate === null) {
    return { softAskReplyRate, incentiveReplyRate, status: STATUS.NOT_APPLICABLE, note: 'Not enough sent touches yet at one or both stages.' };
  }
  const lifting = incentiveReplyRate > softAskReplyRate;
  return {
    softAskReplyRate,
    incentiveReplyRate,
    status: lifting ? STATUS.ON_TRACK : STATUS.BELOW_KILL,
    note: lifting
      ? 'Incentive is outperforming the free ask — the 5% is doing something.'
      : 'Kill signal (Metrics Spec §5): the 5% discount is not outperforming Soft Ask. Revisit the incentive mechanic before scaling, independent of the raw conversion number above.',
  };
}

// Proposal Follow-Up conversion: target >=25% of RESOLVED proposals;
// kill if expired-no-response outnumbers actual conversions (Metrics Spec §6).
function proposalConversion({ fullService, diy, expiredNoResponse, resolvedCount }) {
  const converted = fullService + diy;
  const value = resolvedCount > 0 ? Number(((converted / resolvedCount) * 100).toFixed(1)) : null;
  const killTripped = expiredNoResponse > converted;
  const status = value === null ? STATUS.NOT_APPLICABLE : killTripped ? STATUS.BELOW_KILL : bandStatus(value, { target: 25 });
  return {
    value,
    target: 25,
    unit: '%',
    status,
    note: killTripped
      ? `Kill signal (Metrics Spec §6): ${expiredNoResponse} expired with no response vs. ${converted} converted — more proposals are silently dying than closing, regardless of the ${value ?? '—'}% headline rate.`
      : 'Target is 25% of RESOLVED proposals (excludes still-open ones).',
  };
}

module.exports = { STATUS, replyRate, recoveredRevenue, repeatPurchaseRateYoY, activeAccounts, winBackConversion, incentiveLift, proposalConversion };
