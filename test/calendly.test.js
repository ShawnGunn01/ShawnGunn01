const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { verifySignature, isInviteeCreated, extractAccountId } = require('../src/calendly');

const SIGNING_KEY = 'test-signing-key';

function sign(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', SIGNING_KEY).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

test('verifySignature accepts a correctly signed payload', () => {
  const rawBody = JSON.stringify({ event: 'invitee.created' });
  assert.equal(verifySignature(rawBody, sign(rawBody), SIGNING_KEY), true);
});

test('verifySignature rejects a tampered body', () => {
  const rawBody = JSON.stringify({ event: 'invitee.created' });
  const header = sign(rawBody);
  const tamperedBody = JSON.stringify({ event: 'invitee.created', extra: 'injected' });
  assert.equal(verifySignature(tamperedBody, header, SIGNING_KEY), false);
});

test('verifySignature rejects a signature made with the wrong key', () => {
  const rawBody = JSON.stringify({ event: 'invitee.created' });
  const wrongKeySig = crypto.createHmac('sha256', 'wrong-key').update(`${Math.floor(Date.now() / 1000)}.${rawBody}`).digest('hex');
  assert.equal(verifySignature(rawBody, `t=${Math.floor(Date.now() / 1000)},v1=${wrongKeySig}`, SIGNING_KEY), false);
});

test('verifySignature rejects a missing or malformed header', () => {
  const rawBody = JSON.stringify({ event: 'invitee.created' });
  assert.equal(verifySignature(rawBody, undefined, SIGNING_KEY), false);
  assert.equal(verifySignature(rawBody, 'not-a-real-header', SIGNING_KEY), false);
});

test('isInviteeCreated only matches the invitee.created event type', () => {
  assert.equal(isInviteeCreated({ event: 'invitee.created' }), true);
  assert.equal(isInviteeCreated({ event: 'invitee.canceled' }), false);
  assert.equal(isInviteeCreated(null), false);
});

test('extractAccountId reads the utm_content tracking field Prompt 8 relies on to map a booking to an account', () => {
  const event = { event: 'invitee.created', payload: { tracking: { utm_content: 'SF-0001' } } };
  assert.equal(extractAccountId(event), 'SF-0001');
});

test('extractAccountId returns null when there is no tracking data to match against', () => {
  assert.equal(extractAccountId({ event: 'invitee.created', payload: {} }), null);
  assert.equal(extractAccountId({ event: 'invitee.created' }), null);
});
