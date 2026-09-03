// Monthly operating review (Prompt 10 Item 1).
// ----------------------------------------------
// Deliberately separate from dashboard.js/thresholds.js: the dashboard
// answers "how are we doing right now"; this answers "how are we doing
// this month, and is anything two-months-bad" — a periodic governance
// question with its own history (src/store.js listMonthlyReviews), not a
// live number. Reuses dashboard.getDashboard()'s thresholds rather than
// recomputing them, so there is exactly one place Prompt 3's target/kill
// judgments are computed.

const store = require('./store');
const dashboard = require('./dashboard');
const { todayStr } = require('./dates');

// Draft edit rate (Prompt 10 Item 1): how often an owner sends a draft
// as-is vs. heavily edits it first. Sourced from store.logSend's
// wasEdited flag (Prompt 8 Item 6) — already captured at send time,
// nothing new to instrument. A RISING rate over successive reviews is the
// signal to watch, not the absolute number in isolation.
function draftEditRate(sends) {
  if (sends.length === 0) return { totalSends: 0, editedSends: 0, rate: null };
  const edited = sends.filter((s) => s.wasEdited).length;
  return { totalSends: sends.length, editedSends: edited, rate: Number(((edited / sends.length) * 100).toFixed(1)) };
}

// Opt-out rate over time (Prompt 10 Item 1). Two numbers, not one,
// because they answer different questions: newOptOutsLast30d is the
// leading indicator (is something CURRENTLY driving people away);
// cumulativeRate is the lagging one (how much of the whole cohort has
// been lost to date). Neither is a true cohort-survival rate — that would
// need a synced-date-bucketed denominator this data model doesn't carry
// yet (same class of gap as Metrics Spec gaps #1/#2), flagged here rather
// than quietly approximated as something it isn't.
function optOutTrend(activity, accounts, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const newOptOuts = activity.filter((a) => a.type === 'opted_out' && new Date(a.at).getTime() >= cutoff).length;
  const totalOptedOut = accounts.filter((a) => a.optedOut).length;
  const totalEverSynced = accounts.length;
  return {
    newOptOutsLast30d: newOptOuts,
    totalOptedOut,
    totalEverSynced,
    cumulativeRate: totalEverSynced > 0 ? Number(((totalOptedOut / totalEverSynced) * 100).toFixed(1)) : null,
  };
}

function feedbackSummary(feedback) {
  const byCategory = {};
  for (const f of feedback) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  return { totalFlags: feedback.length, byCategory };
}

// Escalation trigger (Prompt 10 Item 2): a metric that missed its
// target/kill band in BOTH this review and the immediately-prior one.
// "Missed" reads watch or below_kill as a miss (on_track and
// not_applicable are not) — a single bad month is normal variance; two
// running is the thing this process exists to catch before it becomes six.
const MISSED_STATUSES = new Set(['watch', 'below_kill']);

function detectEscalations(currentThresholds, priorReview) {
  if (!priorReview || !priorReview.targets) return [];
  const escalations = [];
  for (const key of Object.keys(currentThresholds)) {
    const cur = currentThresholds[key];
    const prior = priorReview.targets[key];
    if (!cur || !prior || !cur.status || !prior.status) continue;
    if (MISSED_STATUSES.has(cur.status) && MISSED_STATUSES.has(prior.status)) {
      escalations.push({ metric: key, currentStatus: cur.status, priorStatus: prior.status, priorPeriod: priorReview.periodLabel });
    }
  }
  return escalations;
}

// Assembles and PERSISTS one monthly review. Persisting (not just
// returning) is what makes "two months running" detectable on the NEXT
// call — see detectEscalations reading store.listMonthlyReviews(1).
function generateMonthlyReview() {
  const dash = dashboard.getDashboard();
  const accounts = store.listAccounts();
  const sends = store.listSends(2000);
  const activity = store.listActivity(5000);
  const feedback = store.listDraftFeedback({ limit: 1000 });
  const periodLabel = todayStr().slice(0, 7); // 'YYYY-MM'

  // The comparison for "two months running" must be against an EARLIER
  // period, not just whatever was generated most recently — "Generate
  // Review Now" can legitimately be clicked more than once in the same
  // month (re-running it after fixing something), and comparing that
  // regenerated report against itself would manufacture a false
  // escalation out of two clicks rather than two real months.
  const priorReview = store.listMonthlyReviews(50).find((r) => r.periodLabel !== periodLabel) || null;

  const report = {
    generatedAt: new Date().toISOString(),
    periodLabel,
    targets: dash.thresholds,
    draftEditRate: draftEditRate(sends),
    optOutTrend: optOutTrend(activity, accounts),
    feedbackSummary: feedbackSummary(feedback),
  };
  report.escalations = detectEscalations(report.targets, priorReview);

  return store.saveMonthlyReview(report);
}

module.exports = { draftEditRate, optOutTrend, feedbackSummary, detectEscalations, generateMonthlyReview, MISSED_STATUSES };
