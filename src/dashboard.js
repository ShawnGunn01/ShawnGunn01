// Computes the dashboard metrics exactly as specified in Metrics Spec v0.1
// — see that doc for the reasoning behind each calculation, edge case, and
// target/kill threshold. This file implements the calculations; it doesn't
// re-derive them.

const store = require('./store');
const { todayStr } = require('./dates');

const SYNC_STALE_HOURS = 36; // Architecture v0.1 §4

function currentQuarterStart() {
  const now = new Date();
  const qMonth = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), qMonth, 1);
}

// Metrics Spec §2: NOT a true trailing-365-day YoY calculation — the data
// model doesn't have full purchase-date history yet (only the purchases
// log going forward from this system's own launch; see gap #1). This is
// the pilot's lifetime-ratio approximation, explicitly not the real metric.
// Flagged here in code, not just in the doc, so it isn't mistaken for one.
function repeatPurchaseRateYoY(accounts) {
  const withPurchases = accounts.filter((a) => (a.purchaseCount || 0) >= 1);
  if (withPurchases.length === 0) return 0;
  const repeaters = withPurchases.filter((a) => (a.purchaseCount || 0) >= 2);
  return Number(((repeaters.length / withPurchases.length) * 100).toFixed(1));
}

// Reply rate excludes out_of_office by construction — it's a distinct
// status from 'replied', not a filter applied after the fact. See Metrics
// Spec §3.
function replyRateLast30(touches) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sent = touches.filter((t) => t.kind !== 'call_flag' && t.sentAt && new Date(t.sentAt).getTime() >= cutoff);
  if (sent.length === 0) return 0;
  const replied = sent.filter((t) => t.status === 'replied');
  return Number(((replied.length / sent.length) * 100).toFixed(1));
}

// Combined + per-motion, sourced from the purchases log rather than only
// account.rebookedAt — Metrics Spec gap #5-6: Proposal Follow-Up revenue
// was previously invisible here entirely.
function recoveredRevenueQTD() {
  const qStart = currentQuarterStart().getTime();
  const purchases = store.listPurchases().filter((p) => new Date(p.date).getTime() >= qStart);
  const winBack = purchases.filter((p) => p.source === 'rebook').reduce((sum, p) => sum + p.amount, 0);
  const proposalFollowUp = purchases.filter((p) => p.source === 'proposal_follow_up').reduce((sum, p) => sum + p.amount, 0);
  return { total: winBack + proposalFollowUp, winBack, proposalFollowUp };
}

function cohortFunnel(accounts, touches) {
  const dormant = accounts.filter((a) => a.funnel === 'win_back' && a.stage === 'dormant').length;
  const warmUpSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'warm_up' && t.status !== 'pending_review').length;
  const softAskSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'soft_ask' && t.status !== 'pending_review').length;
  const softAskReplied = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'soft_ask' && t.status === 'replied').length;
  const incentiveSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'incentive' && t.status !== 'pending_review').length;
  const incentiveReplied = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'incentive' && t.status === 'replied').length;
  const escalationSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'escalation' && t.status !== 'pending_review').length;
  const rebooked = accounts.reduce((sum, a) => sum + (a.rebookedAt || []).filter((e) => e.fromFunnel === 'win_back').length, 0);

  // Metrics Spec §5: pass-through rates between adjacent stages, not just
  // raw counts — a funnel where everyone marches to Escalation with zero
  // replies is itself the red flag, not something a raw count shows.
  const passThrough = {
    warmUpToSoftAsk: warmUpSent > 0 ? Number(((softAskSent / warmUpSent) * 100).toFixed(1)) : null,
    softAskToIncentive: softAskSent > 0 ? Number(((incentiveSent / softAskSent) * 100).toFixed(1)) : null,
    incentiveToEscalation: incentiveSent > 0 ? Number(((escalationSent / incentiveSent) * 100).toFixed(1)) : null,
    softAskReplyRate: softAskSent > 0 ? Number(((softAskReplied / softAskSent) * 100).toFixed(1)) : null,
    incentiveReplyRate: incentiveSent > 0 ? Number(((incentiveReplied / incentiveSent) * 100).toFixed(1)) : null,
  };

  return { dormant, warmUpSent, softAskReplied, incentiveSent, rebooked, passThrough };
}

// Metrics Spec §6: open (unresolved) proposals reported separately from
// the resolved-outcome split, and expired_no_response tracked as its own
// bucket rather than silently missing from the denominator.
function proposalOutcomes(accounts) {
  const withProposal = accounts.filter((a) => a.proposal);
  const open = withProposal.filter((a) => !a.proposal.outcome);
  const resolved = withProposal.filter((a) => a.proposal.outcome);
  return {
    openCount: open.length,
    resolvedCount: resolved.length,
    fullService: resolved.filter((a) => a.proposal.outcome === 'full_service').length,
    diy: resolved.filter((a) => a.proposal.outcome === 'diy').length,
    lost: resolved.filter((a) => a.proposal.outcome === 'lost').length,
    expiredNoResponse: resolved.filter((a) => a.proposal.outcome === 'expired_no_response').length,
  };
}

function activeAccountsBreakdown(accounts) {
  const active = accounts.filter((a) => a.funnel && a.funnel !== 'none' && !a.optedOut);
  return {
    total: active.length,
    winBack: active.filter((a) => a.funnel === 'win_back').length,
    proposalFollowUp: active.filter((a) => a.funnel === 'proposal_follow_up').length,
    nurture: active.filter((a) => a.funnel === 'nurture').length,
  };
}

function getDashboard() {
  const accounts = store.listAccounts();
  const touches = store.listTouches();
  const revenue = recoveredRevenueQTD();
  const activeAccounts = activeAccountsBreakdown(accounts);
  const staleHours = store.hoursSinceLastSync();

  return {
    generatedAt: todayStr(),
    syncStale: staleHours !== null && staleHours > SYNC_STALE_HOURS,
    hoursSinceLastSync: staleHours,
    activeAccountsInCohort: activeAccounts.total,
    activeAccountsBreakdown: activeAccounts,
    repeatPurchaseRateYoY: repeatPurchaseRateYoY(accounts),
    replyRateLast30: replyRateLast30(touches),
    rebookedRevenueQTD: revenue.total,
    recoveredRevenueQTD: revenue,
    cohortFunnel: cohortFunnel(accounts, touches),
    proposalOutcomes: proposalOutcomes(accounts),
    recentActivity: store.listActivity(25),
    pendingReviewCount: touches.filter((t) => t.status === 'pending_review').length,
    atRiskCount: accounts.filter((a) => a.stage === 'escalation').length,
    lastSyncRun: store.listSyncRuns(1)[0] || null,
    lastEngineRun: store.listEngineRuns(1)[0] || null,
  };
}

module.exports = { getDashboard, SYNC_STALE_HOURS };
