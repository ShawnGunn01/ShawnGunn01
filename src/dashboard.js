// Computes the dashboard metrics exactly as validated with stakeholders —
// see README "Dashboard metrics" for what each one means and how it's derived.

const store = require('./store');
const { todayStr } = require('./dates');

function currentQuarterStart() {
  const now = new Date();
  const qMonth = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), qMonth, 1);
}

function repeatPurchaseRateYoY(accounts) {
  const withPurchases = accounts.filter((a) => (a.purchaseCount || 0) >= 1);
  if (withPurchases.length === 0) return 0;
  const repeaters = withPurchases.filter((a) => (a.purchaseCount || 0) >= 2);
  return Number(((repeaters.length / withPurchases.length) * 100).toFixed(1));
}

function replyRateLast30(touches) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sent = touches.filter((t) => t.sentAt && new Date(t.sentAt).getTime() >= cutoff);
  if (sent.length === 0) return 0;
  const replied = sent.filter((t) => t.status === 'replied');
  return Number(((replied.length / sent.length) * 100).toFixed(1));
}

function rebookedRevenueQTD(accounts) {
  const qStart = currentQuarterStart().getTime();
  let total = 0;
  for (const a of accounts) {
    for (const entry of a.rebookedAt || []) {
      if (new Date(entry.at).getTime() >= qStart) total += Number(entry.amount) || 0;
    }
  }
  return total;
}

function cohortFunnel(accounts, touches) {
  const dormant = accounts.filter((a) => a.funnel === 'win_back' && a.stage === 'dormant').length;
  const warmUpSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'warm_up' && t.status !== 'pending_review').length;
  const softAskReplied = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'soft_ask' && t.status === 'replied').length;
  const incentiveSent = touches.filter((t) => t.funnel === 'win_back' && t.stage === 'incentive' && t.status !== 'pending_review').length;
  const rebooked = accounts.reduce((sum, a) => sum + (a.rebookedAt || []).filter((e) => e.fromFunnel === 'win_back').length, 0);
  return { dormant, warmUpSent, softAskReplied, incentiveSent, rebooked };
}

function proposalOutcomes(accounts) {
  const withOutcome = accounts.filter((a) => a.proposal && a.proposal.outcome);
  return {
    fullService: withOutcome.filter((a) => a.proposal.outcome === 'full_service').length,
    diy: withOutcome.filter((a) => a.proposal.outcome === 'diy').length,
    lost: withOutcome.filter((a) => a.proposal.outcome === 'lost').length,
  };
}

function getDashboard() {
  const accounts = store.listAccounts();
  const touches = store.listTouches();

  return {
    generatedAt: todayStr(),
    activeAccountsInCohort: accounts.filter((a) => a.funnel && a.funnel !== 'none').length,
    repeatPurchaseRateYoY: repeatPurchaseRateYoY(accounts),
    replyRateLast30: replyRateLast30(touches),
    rebookedRevenueQTD: rebookedRevenueQTD(accounts),
    cohortFunnel: cohortFunnel(accounts, touches),
    proposalOutcomes: proposalOutcomes(accounts),
    recentActivity: store.listActivity(25),
    pendingReviewCount: touches.filter((t) => t.status === 'pending_review').length,
    atRiskCount: accounts.filter((a) => a.stage === 'escalation').length,
  };
}

module.exports = { getDashboard };
