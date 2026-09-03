const test = require('node:test');
const assert = require('node:assert/strict');

const thresholds = require('../src/thresholds');

test('replyRate: below kill (5%), between kill and target (watch), at/above target (on track)', () => {
  assert.equal(thresholds.replyRate(2).status, 'below_kill');
  assert.equal(thresholds.replyRate(10).status, 'watch');
  assert.equal(thresholds.replyRate(15).status, 'on_track');
  assert.equal(thresholds.replyRate(22).status, 'on_track');
});

test('recoveredRevenue: kill band is $3,000-5,000, no target above it', () => {
  assert.equal(thresholds.recoveredRevenue(1000).status, 'below_kill');
  assert.equal(thresholds.recoveredRevenue(4000).status, 'watch');
  assert.equal(thresholds.recoveredRevenue(6000).status, 'on_track');
  assert.equal(thresholds.recoveredRevenue(6000).target, undefined);
});

test('repeatPurchaseRateYoY is always not_applicable during the pilot, regardless of value', () => {
  assert.equal(thresholds.repeatPurchaseRateYoY(0).status, 'not_applicable');
  assert.equal(thresholds.repeatPurchaseRateYoY(99).status, 'not_applicable');
});

test('activeAccounts never carries a target/kill judgment — coverage check only', () => {
  const r = thresholds.activeAccounts(30);
  assert.equal(r.status, 'not_applicable');
  assert.equal(r.kill, undefined);
  assert.equal(r.target, undefined);
});

test('winBackConversion: target 12%, computed as rebooked/warmUpSent', () => {
  assert.equal(thresholds.winBackConversion(1, 10).value, 10); // 10% — below 12% target
  assert.equal(thresholds.winBackConversion(1, 10).status, 'watch');
  assert.equal(thresholds.winBackConversion(2, 10).value, 20);
  assert.equal(thresholds.winBackConversion(2, 10).status, 'on_track');
  assert.equal(thresholds.winBackConversion(0, 0).status, 'not_applicable');
});

test('incentiveLift: on track only if Incentive reply rate beats Soft Ask reply rate', () => {
  assert.equal(thresholds.incentiveLift(10, 25).status, 'on_track');
  assert.equal(thresholds.incentiveLift(20, 15).status, 'below_kill', 'incentive underperforming the free ask is the kill signal, not a raw number');
  assert.equal(thresholds.incentiveLift(null, null).status, 'not_applicable');
});

test('proposalConversion: target 25% of resolved, kill if expired-no-response outnumbers conversions', () => {
  const healthy = thresholds.proposalConversion({ fullService: 2, diy: 1, expiredNoResponse: 1, resolvedCount: 6 });
  assert.equal(healthy.value, 50);
  assert.equal(healthy.status, 'on_track');

  const belowTarget = thresholds.proposalConversion({ fullService: 1, diy: 0, expiredNoResponse: 0, resolvedCount: 6 });
  assert.equal(belowTarget.status, 'watch');

  const killed = thresholds.proposalConversion({ fullService: 1, diy: 0, expiredNoResponse: 3, resolvedCount: 5 });
  assert.equal(killed.status, 'below_kill', 'more expired than converted must kill regardless of the raw percentage');

  const noData = thresholds.proposalConversion({ fullService: 0, diy: 0, expiredNoResponse: 0, resolvedCount: 0 });
  assert.equal(noData.status, 'not_applicable');
});
