# Impact4Good Win-Back & Proposal Follow-Up System

A pilot build of the account win-back and proposal follow-up automation
described below. It implements the cohort/timing logic, the AI drafting
engine, the owner review queue, and the dashboard as real, tested code. The
external pieces of the architecture (Salesforce, Make.com, Gmail, Calendly)
are integration points this app exposes — see **What's real vs. what's
stubbed** before showing this to anyone outside the pilot.

## The three motions

1. **Win-Back** — trigger: account dormant 12+ months, no event booked.
2. **Proposal Follow-Up** — trigger: proposal sent, no response.
3. **Always-On Nurture** — no trigger, continuous; catches anyone who exits
   #1 or #2 without converting, plus active clients between purchases.

**Loop logic:** any funnel exit without converting drops the account into
Nurture. A Nurture account that later goes dormant automatically re-enters
Win-Back.

## Cohort & timing rules

**Win-Back entry** — purchased in the last 12 months, no event currently
booked, last touch > 60 days ago.

**Win-Back sequence** (timed to the client's own event anniversary):

| Stage | Window | Delivery |
| --- | --- | --- |
| Warm-Up | 60–90 days out | automation only, no ask |
| Soft Ask | 30–45 days out | AI drafts, owner sends |
| Incentive | 14–21 days out, no reply | AI drafts, owner sends, 5–10% off within a stated window |
| Escalation | 7 days out, no reply | owner's personal call/text, flagged at-risk |

**Proposal Follow-Up** (off the proposal's own sent date / event date):

| Step | Window | Note |
| --- | --- | --- |
| Check-In | 3+ business days, no response | soft AI draft |
| DIY Fallback | 7–10 business days, no response | introduces the $4,500 DIY minimum as a choice, never a downsell |
| Final Anchor | timed to the event date | not a fixed interval |

An account with a live, un-resolved proposal is treated as mid-conversation
and takes the Proposal Follow-Up path even if it would otherwise look
dormant — see `src/engine.js` for the exact precedence.

## Ownership

Every account has one owner: **Audrey** or **Nick**. The AI drafts every
touch; the owner reviews, personalizes, and sends from their own inbox —
**nothing in this app auto-sends**. They're meant to be cross-trained as
backup for each other (tracked informationally on the Owners tab). Rebooked
deals count toward normal quota credit (`POST /api/accounts/:id/rebook`
records who/what/how much).

## Compliance

Every automated-sequence draft includes a visible opt-out line
(`src/drafts.js`). `GET /api/unsubscribe/:accountId` is the link recipients
would click — it suppresses the account from all future automated touches
until manually cleared, and the cohort/timing engine skips opted-out
accounts entirely (`engine.js` filters them out before any funnel logic
runs).

## Architecture

```
Salesforce (source of truth, read-only, never modified)
        │  nightly + event-triggered sync
        ▼
   Make.com  ──────────────►  POST /api/sync/accounts  (this app)
                                       │
                                       ▼
                              Data Store (accounts.json / touches.json)
                                       │
                              Cohort/Timing Engine  (POST /api/engine/run)
                                       │
                              AI Drafting Engine  (src/drafts.js)
                                       │
                                       ▼
                              Owner Review Queue  (dashboard UI)
                                       │
                     owner edits, then sends personally
                                       │
                         ┌─────────────┴─────────────┐
                         ▼                             ▼
                  Gmail (owner's own inbox)      Calendly (per-owner link)
                                       │
                                       ▼
                              Dashboard (opens/replies/bookings
                              feed back into cohort logic)
```

### What's real vs. what's stubbed

This app implements the **Data Store**, **Cohort/Timing Logic**, **AI
Drafting Engine**, and **Owner Review Queue** boxes as working, tested code.
It does not (and cannot, without credentials) implement the Salesforce,
Make.com, Gmail, or Calendly integrations themselves — those are configured
in their own tools and pointed at this app:

- **Salesforce → this app**: nothing to build here. Configure the Make.com
  scenario to call `POST /api/sync/accounts` (see below for the payload
  shape) on your nightly schedule and on the Salesforce events you want to
  trigger a sync. This app never writes back to Salesforce.
- **AI drafting**: `src/drafts.js` currently fills stage-specific templates
  rather than calling a real language model. Every draft still lands in the
  review queue and still gets the compliance footer — swapping in a real
  model call means replacing the body of the template functions with an API
  call that returns `{ subject, body }`; nothing else in the pipeline
  changes.
- **Gmail send is real** (Prompt 8) — "Approve & Send" in the review queue
  calls the Gmail API directly via per-owner OAuth (`src/gmail.js`), never a
  shared account. It requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  and `GOOGLE_REDIRECT_URI` to be provisioned (a Google Cloud OAuth client
  with the Gmail API enabled) before any owner can connect — see **Owner
  workflow setup** below. Without them, "Connect Gmail" on the Owners tab
  returns a clear error instead of failing silently.
- **Calendly booking → auto-rebook is real** (Prompt 8) — `POST
  /api/webhooks/calendly` marks an account "Rebooked" the moment its owner's
  Calendly link gets booked, no manual step. Requires registering a webhook
  subscription with Calendly and setting `CALENDLY_WEBHOOK_SIGNING_KEY` —
  see **Owner workflow setup** below.
- **Reply tracking**: there's still no inbox-parsing integration. A touch is
  marked "Replied" manually by the owner from the "Sent — Awaiting Reply"
  list, which is what feeds the reply-rate metric and the "stand down if
  replied" sequencing logic.

Given the budget (~$20–95/mo tools) and the "self-hosted dashboard
near-$0" line in the brief, this app *is* that self-hosted dashboard piece.

## Owner workflow setup (Prompt 8)

Two credentials must be provisioned before the owner-facing workflow is
fully live — without them the app runs fine, but connect/send and the
webhook are disabled with a clear error rather than failing silently
(console warnings print at startup for both, same pattern as `SYNC_TOKEN`):

1. **Gmail OAuth** — create a Google Cloud OAuth 2.0 client (Gmail API
   enabled, `https://www.googleapis.com/auth/gmail.send` +
   `.../auth/userinfo.email` scopes), add
   `<APP_BASE_URL>/api/gmail/callback` as an authorized redirect URI, and
   set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
   in the environment. Each owner then clicks **Connect Gmail** on the
   Owners tab and authorizes their own account — the refresh token is
   stored on that owner's record only (`src/store.js` `gmailTokens`) and
   used only for sends attributed to them.
2. **Calendly webhook** — register a webhook subscription (Calendly's
   webhook subscription API) for the `invitee.created` event, pointed at
   `POST <APP_BASE_URL>/api/webhooks/calendly`, and set
   `CALENDLY_WEBHOOK_SIGNING_KEY` to the signing key Calendly gives you for
   that subscription. No other Calendly-side configuration is needed — the
   booking-to-account mapping rides on a `?utm_content=<accountId>` tracking
   parameter this app already appends to every Calendly link it drafts
   (`src/interpolate.js`), which Calendly passes straight through to the
   webhook payload.

### Per-owner review queue and backup coverage

Each owner (Audrey, Nick) sees only their own queue on the Review Queue tab
by default. The one documented way into someone else's queue is backup
coverage: if the Owners tab has your record naming who you cover (the
`backupFor` field — set by an admin, never self-declared), a "Cover
[Name]'s queue" button appears; using it requires typing a reason, and the
access is logged (`backup_queue_access` in the activity feed) every time.
Admins (Shawn, Ira) see every queue without any of this, since that's
oversight, not backup coverage. Approve & Send always goes out through the
*assigned* owner's own Gmail regardless of who clicked it — backup coverage
means operating someone's queue while they're out, not sending as yourself.

### Opt-out — compliance-critical, so spelled out precisely

`GET /api/unsubscribe/:accountId` (the link in every automated email's
footer) and `POST /api/accounts/:id/opt-out` (an internal action) are the
only two doors that set an account opted-out, and both go through the same
function, `store.setOptOut(accountId, true)`. The instant that runs:

- The account flips to `optedOut: true`, `funnel: 'none'`, `stage: null`.
- The cohort/timing engine (`src/engine.js` `runEngineTick`) filters
  opted-out accounts out **before** any per-account motion logic runs — so
  this one filter covers Win-Back, Proposal Follow-Up, and Nurture alike;
  there's no separate opt-out check needed (or possible to forget) inside
  each motion.
- Nothing further happens on a timer or a queue — suppression is immediate
  and stays in effect indefinitely.

The only way back is `POST /api/accounts/:id/clear-optout`, **admin-only**
(Shawn/Ira — reversing a compliance suppression is a deliberate decision,
not a routine action), which also goes through `store.setOptOut`, this time
with `false`. Clearing resets `funnel` to `'none'` rather than resuming
mid-sequence, so the engine re-evaluates the account from scratch on its
next tick instead of picking up as if the opt-out never happened.

Both directions are logged to the activity feed (`opted_out` /
`optout_cleared`), visible on the dashboard.

Proof this actually holds, not just reads correctly: `test/optout.test.js`
seeds an account into each of the three motions, opts it out mid-sequence,
runs the engine, and asserts no new touch is drafted for any of them —
plus one test that hits the real `GET /api/unsubscribe/:id` HTTP route
(not just the underlying store function) and confirms the engine honors it
on the very next tick, and one confirming a viewer's clear-optout attempt
is rejected while an admin's succeeds.

## Known risks (carried into every design decision here)

- Impact4Good is mid a sell-side process — this needs to stay stable ahead
  of any buyer technical review. Nothing here touches Salesforce data
  destructively; the sync is additive/read-only by construction
  (`store.syncAccounts` only ever updates the fixed `SOURCE_FIELDS` list).
- Shawn is a single point of failure for the build — this README, plus
  comments in `engine.js` and `dashboard.js`, are written so someone else
  could pick this up without a handoff call.
- No opt-out mechanism existed before this — it's in v1 (see Compliance
  above), not bolted on later.
- Backup coverage between Audrey and Nick isn't wired into any access
  control here — the Owners tab just records who's backup for whom as
  reference info.

## Getting started

```bash
npm install
npm start
```

Open http://localhost:3000. Data persists as JSON files under `data/`
(git-ignored). To see the whole pipeline without a live Salesforce
connection, click **Load Sample Accounts** on the Dashboard tab (or
`POST /api/dev/seed`) — this loads `data/sample-accounts.json`, a stand-in
for the first Make.com sync with accounts illustrating every stage: Warm-Up,
Soft Ask, Incentive, Escalation (at-risk), Proposal Follow-Up, an account
excluded for having a booked event, and one excluded for being over the
12-month purchase window. Then click **Run Cohort Engine** to advance the
timing logic and populate the Review Queue.

## Project layout

```
src/server.js     Express app + REST API
src/store.js      JSON persistence for accounts, touches, owners, activity log
src/engine.js     Cohort/timing logic — the rules tables above, as code
src/drafts.js     AI Drafting Engine (template-based; see stub note above)
src/dashboard.js  Computes the validated dashboard metrics
src/dates.js      Date/business-day helpers used by the engine
src/csv.js        Dependency-free CSV parse/serialize (for future export needs)
public/           Frontend: Dashboard, Review Queue, Accounts, Owners tabs
test/             node:test coverage for the cohort/timing rules
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sync/accounts` | Make.com → this app: upsert accounts (`{ accounts: [...] }` or a bare array). Only touches source-of-truth fields. |
| POST | `/api/engine/run` | Advance the cohort/timing engine one tick; drafts due touches. Call on the same cadence as the sync. |
| GET | `/api/accounts` | List accounts with current funnel/stage |
| GET | `/api/accounts/:id` | Account detail with its touch history |
| POST | `/api/accounts/:id/opt-out` | Compliance opt-out (internal action) |
| GET | `/api/unsubscribe/:id` | Public opt-out link used in email footers — see the opt-out walkthrough above |
| POST | `/api/accounts/:id/clear-optout` | Admin-only: manually reverses an opt-out |
| POST | `/api/accounts/:id/rebook` | Record a win-back conversion + revenue |
| POST | `/api/accounts/:id/proposal` | Log a sent proposal (enters Proposal Follow-Up) |
| POST | `/api/accounts/:id/proposal/outcome` | Record `full_service` / `diy` / `lost` |
| GET | `/api/owners` | List Audrey/Nick + their email/Calendly link/Gmail connection status |
| PATCH | `/api/owners/:id` | Update an owner's email/Calendly link |
| GET | `/api/owners/:id/gmail/connect` | Returns the Google OAuth consent URL for this owner |
| GET | `/api/gmail/callback` | OAuth redirect target — exchanges the code, stores the owner's refresh token |
| POST | `/api/owners/:id/gmail/disconnect` | Disconnects an owner's Gmail |
| GET | `/api/touches?status=&asOwner=&backupReason=` | Per-owner queue, scoped to the caller by default — see "Per-owner review queue and backup coverage" above |
| PATCH | `/api/touches/:id` | Edit a draft, or mark replied/out_of_office/skipped |
| POST | `/api/touches/:id/send` | Approve & Send — hard-blocks on missing opt-out/Calendly links or an unconnected Gmail, then sends via the assigned owner's Gmail |
| GET | `/api/sends` | Full send audit: who, when, edited-or-not, per Prompt 8 Item 6 |
| POST | `/api/webhooks/calendly` | Calendly `invitee.created` → auto-marks the tracked account Rebooked |
| GET | `/api/dashboard` | The validated dashboard metrics |
| POST | `/api/dev/seed` | Load `data/sample-accounts.json` for a demo |

### Sample sync payload

```json
POST /api/sync/accounts
{
  "accounts": [
    {
      "id": "SF-0001",
      "name": "Harborview Foundation",
      "contactName": "Renee Ibarra",
      "contactEmail": "renee@harborviewfdn.example",
      "ownerId": "audrey",
      "lastPurchaseDate": "2025-10-15",
      "purchaseCount": 3,
      "eventBookedDate": "",
      "eventAnniversaryDate": "2026-11-16",
      "lastTouchDate": "2025-10-15",
      "proposal": { "sentDate": "2026-08-20", "eventDate": "2026-09-08", "outcome": null }
    }
  ]
}
```

## Tests

```bash
npm test
```

Covers the cohort eligibility rule, all four Win-Back stage windows, the
"stand down if replied" gating on Incentive/Escalation and DIY Fallback, the
Nurture loop-back re-entry, the Proposal Follow-Up windows (including the
event-date-anchored Final Anchor), and compliance opt-out exclusion.

## Assumptions worth flagging to Ira / Dami before this goes live

These fill in a few places the brief didn't fully spell out — flagging them
explicitly rather than quietly picking an interpretation:

- **Anniversary date source**: if Salesforce doesn't send an explicit
  `eventAnniversaryDate`, this app defaults it to `lastPurchaseDate + 365
  days`. Confirm this matches how "the client's own event anniversary" is
  actually tracked in Salesforce.
- **Proposal vs. Win-Back precedence**: an account with an open proposal is
  routed to Proposal Follow-Up even if it would also qualify as dormant.
- **Nurture cadence**: the brief doesn't specify a nurture touch interval;
  this defaults to a check-in every 90 days of no contact
  (`NURTURE_INTERVAL_DAYS` in `engine.js`).
- **Stage windows are independent, not strictly sequential**: if an account
  first becomes eligible when its anniversary is already inside a later
  window (e.g. re-entering Win-Back 10 days out), the engine drafts that
  later stage directly rather than forcing it through earlier stages first.
