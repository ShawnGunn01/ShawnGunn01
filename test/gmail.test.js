const test = require('node:test');
const assert = require('node:assert/strict');

const gmail = require('../src/gmail');

// A fake googleapis client — injected via the `google` param every gmail.js
// function accepts, so these tests never touch the real network or need
// real OAuth credentials (same dependency-injection pattern the rest of
// this codebase uses to keep tests offline).
function fakeGoogle({ sendImpl } = {}) {
  const calls = { getToken: [], setCredentials: [], send: [] };
  class FakeOAuth2 {
    constructor(clientId, clientSecret, redirectUri) {
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.redirectUri = redirectUri;
    }
    generateAuthUrl(opts) {
      return `https://fake-google-auth.example/o?client_id=${this.clientId}&state=${opts.state}&scope=${encodeURIComponent(opts.scope.join(' '))}&access_type=${opts.access_type}`;
    }
    async getToken(code) {
      calls.getToken.push(code);
      return { tokens: { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expiry_date: Date.now() + 3600000 } };
    }
    setCredentials(creds) {
      calls.setCredentials.push(creds);
      this.credentials = creds;
    }
  }
  const google = {
    auth: { OAuth2: FakeOAuth2 },
    oauth2: () => ({ userinfo: { get: async () => ({ data: { email: 'audrey@impact4good.example' } }) } }),
    gmail: () => ({
      users: {
        messages: {
          send: async ({ userId, requestBody }) => {
            calls.send.push({ userId, requestBody });
            if (sendImpl) return sendImpl({ userId, requestBody });
            return { data: { id: 'msg_fake123', threadId: 'thread_fake123' } };
          },
        },
      },
    }),
  };
  return { google, calls };
}

test.beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/gmail/callback';
});

test('credentialsConfigured is false unless all three env vars are set', () => {
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(gmail.credentialsConfigured(), false);
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  assert.equal(gmail.credentialsConfigured(), true);
});

test('getAuthUrl carries the ownerId as state and requests offline access + gmail.send scope', () => {
  const { google } = fakeGoogle();
  const url = gmail.getAuthUrl('audrey', google);
  assert.match(url, /state=audrey/);
  assert.match(url, /access_type=offline/);
  assert.match(url, /gmail\.send/);
});

test('exchangeCodeForTokens returns the refresh token and connected email', async () => {
  const { google, calls } = fakeGoogle();
  const result = await gmail.exchangeCodeForTokens('fake-code', google);
  assert.equal(result.refreshToken, 'fake-refresh-token');
  assert.equal(result.email, 'audrey@impact4good.example');
  assert.equal(calls.getToken[0], 'fake-code');
});

test('sendEmail refuses to send when the owner has no refresh token — never falls back to anything', async () => {
  const { google } = fakeGoogle();
  await assert.rejects(
    () => gmail.sendEmail({ ownerTokens: null, toEmail: 'x@example.com', subject: 'Hi', body: 'Hi' }, google),
    /has not connected Gmail/
  );
  await assert.rejects(
    () => gmail.sendEmail({ ownerTokens: { email: 'audrey@impact4good.example' }, toEmail: 'x@example.com', subject: 'Hi', body: 'Hi' }, google),
    /has not connected Gmail/
  );
});

test('sendEmail sends through the given owner\'s tokens and returns the Gmail message id', async () => {
  const { google, calls } = fakeGoogle();
  const result = await gmail.sendEmail(
    { ownerTokens: { refreshToken: 'fake-refresh-token', email: 'audrey@impact4good.example' }, toEmail: 'renee@example.com', toName: 'Renee', subject: 'Ready to plan?', body: 'Hi Renee,\n\nBody.' },
    google
  );
  assert.equal(result.messageId, 'msg_fake123');
  assert.equal(calls.send.length, 1);

  const raw = calls.send[0].requestBody.raw;
  const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(decoded, /To: Renee <renee@example\.com>/);
  assert.match(decoded, /From: audrey@impact4good\.example/);
  assert.match(decoded, /Subject: Ready to plan\?/);
  assert.match(decoded, /Body\./);
});
