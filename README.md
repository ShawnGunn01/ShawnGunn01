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
- **Gmail send**: the review queue shows the editable draft and a "Mark
  Sent" action; it does not call the Gmail API. Owners copy/paste (or you
  can wire a `mailto:` / Gmail compose deep link) and send from their own
  inbox, matching the "nothing auto-sends" rule.
- **Calendly**: owners' Calendly links are stored (Owners tab /
  `PATCH /api/owners/:id`) and interpolated into draft templates as
  `{{OWNER_CALENDLY_LINK}}`; there's no live Calendly API call.
- **Reply tracking**: there's no inbox-parsing integration. A touch is
  marked "Replied" manually by the owner from the review queue, which is
  what feeds the reply-rate metric and the "stand down if replied"
  sequencing logic.

Given the budget (~$20–95/mo tools) and the "self-hosted dashboard
near-$0" line in the brief, this app *is* that self-hosted dashboard piece.

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
| GET | `/api/unsubscribe/:id` | Public opt-out link used in email footers |
| POST | `/api/accounts/:id/rebook` | Record a win-back conversion + revenue |
| POST | `/api/accounts/:id/proposal` | Log a sent proposal (enters Proposal Follow-Up) |
| POST | `/api/accounts/:id/proposal/outcome` | Record `full_service` / `diy` / `lost` |
| GET | `/api/owners` | List Audrey/Nick + their email/Calendly link |
| PATCH | `/api/owners/:id` | Update an owner's email/Calendly link |
| GET | `/api/touches?ownerId=&status=` | Review queue (pending/sent/replied/skipped) |
| PATCH | `/api/touches/:id` | Edit a draft, or mark sent/replied/skipped |
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
