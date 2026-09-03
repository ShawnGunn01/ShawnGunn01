// Per-owner Gmail send — OAuth2, never a shared account.
// -----------------------------------------------------------
// Each owner (Audrey, Nick) connects their OWN Gmail via OAuth from the
// Owners tab. The resulting refresh token is stored on that owner's record
// (store.js) and used only to send on that owner's behalf — there is no
// shared/service mailbox anywhere in this flow, matching Prompt 8 Item 3.
//
// Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in
// the environment (a Google Cloud OAuth client with the Gmail API enabled
// and the redirect URI registered) before any owner can actually connect —
// same "provision this before going live" pattern as SYNC_TOKEN. Until
// then, /api/owners/:id/gmail/connect returns a clear 501, not a silent
// failure, and Approve & Send is blocked with "Owner has not connected
// Gmail" (see server.js).
//
// The `google` client is a parameter (defaulting to the real googleapis
// import) so tests can inject a fake OAuth2/Gmail client instead of making
// live network calls — same dependency-injection pattern the rest of this
// codebase uses to keep tests offline (see scripts/eval-drafts.js using a
// throwaway data dir instead of touching data/*.json).

const { google: defaultGoogle } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'];

function credentialsConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function makeOAuthClient(google = defaultGoogle) {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

// state carries the ownerId through the OAuth round trip so the callback
// knows which owner's record to attach the resulting tokens to.
function getAuthUrl(ownerId, google = defaultGoogle) {
  const client = makeOAuthClient(google);
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token, not just a short-lived access_token
    prompt: 'consent', // forces a refresh_token on every connect, even a reconnect
    scope: SCOPES,
    state: ownerId,
  });
}

// Exchanges the OAuth callback's ?code for tokens, and fetches the
// connected email address so the UI can show "Connected as x@gmail.com" —
// which also lets an owner (or Shawn) visually catch it if the wrong
// Google account got connected.
async function exchangeCodeForTokens(code, google = defaultGoogle) {
  const client = makeOAuthClient(google);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date,
    email: data.email,
  };
}

function buildRawMessage({ toEmail, toName, fromEmail, subject, body }) {
  const to = toName ? `${toName} <${toEmail}>` : toEmail;
  const lines = [
    `To: ${to}`,
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ];
  const message = lines.join('\r\n');
  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sends one email through the given owner's connected Gmail. `ownerTokens`
// is that owner's stored { refreshToken, email } (store.js `gmailTokens`).
// The googleapis client auto-refreshes the access token from the refresh
// token as needed — nothing here has to manage expiry manually.
async function sendEmail({ ownerTokens, toEmail, toName, subject, body }, google = defaultGoogle) {
  if (!ownerTokens || !ownerTokens.refreshToken) {
    throw new Error('Owner has not connected Gmail — cannot send.');
  }
  const client = makeOAuthClient(google);
  client.setCredentials({ refresh_token: ownerTokens.refreshToken });

  const gmail = google.gmail({ auth: client, version: 'v1' });
  const raw = buildRawMessage({ toEmail, toName, fromEmail: ownerTokens.email, subject, body });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { messageId: res.data.id, threadId: res.data.threadId };
}

module.exports = { credentialsConfigured, getAuthUrl, exchangeCodeForTokens, sendEmail, buildRawMessage, SCOPES };
