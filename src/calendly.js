// Calendly webhook — booking events auto-mark an account "Rebooked."
// -----------------------------------------------------------------
// Prompt 8 Item 4: no manual step for the owner. Calendly's
// `invitee.created` event fires the moment someone books; this module
// verifies the request really came from Calendly, then maps the booking
// back to a specific account.
//
// Mapping mechanism: every {{OWNER_CALENDLY_LINK}} this app interpolates
// into a draft (src/interpolate.js) has `?utm_content=<accountId>`
// appended. Calendly passes UTM parameters through to the invitee payload
// as `payload.tracking.utm_content` — that's the one field this module
// actually needs to read. No Calendly-side configuration beyond a normal
// event type is required for this to work.
//
// Requires CALENDLY_WEBHOOK_SIGNING_KEY in the environment (Calendly gives
// you this when you register the webhook subscription via their API) —
// same "provision before going live" pattern as SYNC_TOKEN. Without it,
// signature verification is skipped and a startup warning prints (see
// server.js) — fine for local testing against a synthetic payload, not
// safe for a real deployment.

const crypto = require('crypto');

// Calendly signs as `Calendly-Webhook-Signature: t=<timestamp>,v1=<hexHmac>`,
// HMAC-SHA256 over `${timestamp}.${rawBody}` with the subscription's signing key.
function verifySignature(rawBody, signatureHeader, signingKey) {
  if (!signatureHeader || !rawBody) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((kv) => kv.split('=')));
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}.${rawBody}`).digest('hex');
  // Constant-time comparison — a signature check that leaks timing is not a real check.
  const expectedBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== gotBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, gotBuf);
}

function isInviteeCreated(event) {
  return !!event && event.event === 'invitee.created';
}

function extractAccountId(event) {
  const tracking = event && event.payload && event.payload.tracking;
  return (tracking && tracking.utm_content) || null;
}

// Webhooks are commonly delivered more than once for the same booking —
// a retry after a slow/failed response, or a genuine provider replay —
// so this is an expected case to handle, not a hypothetical one. Calendly
// gives each invitee a stable resource URI; that's the natural dedup key.
// Falls back to the event's own top-level uri (present on some payload
// shapes) if the invitee-level one is absent; returns null only when
// neither exists, in which case the caller can't dedupe this one.
function extractEventKey(event) {
  return (event && event.payload && event.payload.uri) || (event && event.uri) || null;
}

module.exports = { verifySignature, isInviteeCreated, extractAccountId, extractEventKey };
