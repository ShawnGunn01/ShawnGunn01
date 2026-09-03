-- Impact4Good Win-Back & Proposal Follow-Up — initial schema
-- Ready to apply to a Postgres/Supabase project whenever one is
-- provisioned (see Architecture v0.1 §2.1). Mirrors the JSON store in
-- src/store.js field-for-field so the migration is a straight lift, not a
-- redesign — apply this, then swap store.js's file I/O for queries against
-- these tables; the engine/dashboard/server code above it does not change.
--
-- Not applied anywhere yet. Hold off on provisioning was the explicit
-- decision as of this build — see the accompanying runbook.

create extension if not exists pgcrypto; -- gen_random_uuid(), if surrogate ids are ever wanted

-- ---------- owners ----------

create table owners (
  id                    text primary key,           -- 'audrey' | 'nick'
  name                  text not null,
  email                 text not null default '',
  calendly_link         text not null default '',
  backup_for            text references owners(id),
  -- Per-owner Gmail OAuth (Prompt 8 Item 3) — never a shared account.
  -- The refresh token is the only long-lived credential; access tokens are
  -- fetched on demand and never stored.
  gmail_refresh_token   text,
  gmail_connected_email text,
  gmail_connected_at    timestamptz
);

-- ---------- users ----------
-- Dashboard + queue access control (Prompt 7/8). NOT real authentication —
-- a pragmatic role gate appropriate to a 4-person internal pilot tool's
-- threat model. See src/access.js and the runbook for why, and what
-- replaces this (e.g. Supabase Auth) before this leaves pilot status.
-- Defined here, ahead of touches, because touches.sent_by references it.

create table users (
  id    text primary key,        -- matches the X-User-Id header value
  name  text not null,
  role  text not null check (role in ('admin','viewer'))
);

-- ---------- accounts ----------
-- Mirrors Salesforce via the Make.com sync (read-only from Salesforce's
-- side). sync_upsert_account() below only ever touches the SOURCE columns
-- — funnel/stage/opted_out/proposal outcome are never overwritten by a
-- re-sync, matching store.js's syncAccounts().

create table accounts (
  id                    text primary key,      -- Salesforce record id
  name                  text not null,
  contact_name          text not null default '',
  contact_email         text not null default '',
  owner_id              text not null references owners(id),

  -- SOURCE fields (Salesforce-owned; sync upserts these only)
  last_purchase_date    date not null,
  purchase_count        integer not null default 1,
  event_booked_date     date,
  event_anniversary_date date,

  -- LOCAL fields (this system owns these; sync never writes them)
  last_touch_date       date,
  proposal              jsonb,                  -- {sentDate, eventDate, outcome, amount, lostReason}
  funnel                text not null default 'none'
                          check (funnel in ('none','win_back','proposal_follow_up','nurture')),
  stage                 text,
  stage_entered_date    date,
  opted_out             boolean not null default false,
  rebooked_revenue      numeric not null default 0,

  created_at            timestamptz not null default now(),
  synced_at             timestamptz not null default now()
);

create index accounts_owner_idx on accounts(owner_id);
create index accounts_funnel_stage_idx on accounts(funnel, stage);
create index accounts_synced_at_idx on accounts(synced_at); -- staleness banner query

-- Win-Back rebookings, one row per conversion (was accounts.rebookedAt[] —
-- normalized here since Postgres has no reason to keep it as an array).
create table rebookings (
  id           uuid primary key default gen_random_uuid(),
  account_id   text not null references accounts(id),
  at           timestamptz not null default now(),
  amount       numeric not null default 0,
  from_funnel  text not null
);

-- ---------- touches (AI-drafted outreach, owner reviews & sends) ----------

create table touches (
  id                 uuid primary key default gen_random_uuid(),
  account_id         text not null references accounts(id),
  funnel             text not null check (funnel in ('win_back','proposal_follow_up','nurture')),
  stage              text not null,
  kind               text not null default 'email' check (kind in ('email','call_flag')),
  subject            text,
  body               text not null,
  -- Immutable snapshot of what the drafting engine generated — never
  -- updated by later edits — so "edited before send" (Prompt 8 Item 6) is
  -- a real comparison against current subject/body, not a guess.
  original_subject   text,
  original_body      text,
  owner_id           text not null references owners(id),
  draft_source       text not null default 'template' check (draft_source in ('template','ai','template_fallback')),
  status             text not null default 'pending_review'
                       check (status in ('pending_review','sent','replied','out_of_office','skipped')),
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  sent_by            text references users(id), -- who clicked Approve & Send (may differ from owner_id — backup coverage; can be an admin, so this references users, not owners)
  was_edited_at_send boolean,
  gmail_message_id   text,
  replied_at         timestamptz,
  reply_marked_by    text references owners(id)
);

create index touches_account_funnel_stage_idx on touches(account_id, funnel, stage);
create index touches_status_owner_idx on touches(status, owner_id);
create index touches_sent_at_idx on touches(sent_at); -- reply-rate 30-day window query

-- ---------- purchases (event log — Metrics Spec gap #1) ----------
-- One dated row per purchase, not a running counter. This is what a real
-- trailing-window Repeat-Purchase Rate needs and accounts.purchase_count
-- alone cannot answer. Sourced from Salesforce (if/when sync includes
-- purchase history) or recorded by this system on a rebook / proposal
-- conversion.

create table purchases (
  id           uuid primary key default gen_random_uuid(),
  account_id   text not null references accounts(id),
  date         date not null,
  amount       numeric not null default 0,
  source       text not null check (source in ('salesforce_sync','rebook','proposal_follow_up')),
  recorded_at  timestamptz not null default now()
);

create index purchases_account_date_idx on purchases(account_id, date);
create index purchases_date_idx on purchases(date); -- quarter-to-date rollups

-- ---------- metrics_snapshots (Metrics Spec gap #2) ----------
-- Written on a schedule so a YoY comparison is a lookup, not a full
-- recompute. See runbook for how this gets populated once live.

create table metrics_snapshots (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  metric_name  text not null,
  value        numeric not null,
  computed_at  timestamptz not null default now()
);

create index metrics_snapshots_name_period_idx on metrics_snapshots(metric_name, period_start);

-- ---------- activity (per-account, human-readable) ----------

create table activity (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  account_id  text references accounts(id),
  summary     text not null,
  at          timestamptz not null default now(),
  extra       jsonb
);

create index activity_account_idx on activity(account_id);
create index activity_at_idx on activity(at desc);

-- ---------- sync_runs / engine_runs (per-run, machine — "reviewable without opening Make.com") ----------

create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  skipped_count  integer not null default 0,
  skipped        jsonb not null default '[]',
  status         text not null check (status in ('ok','partial','error')),
  error_message  text
);

create table engine_runs (
  id                 uuid primary key default gen_random_uuid(),
  at                 timestamptz not null default now(),
  started_at         timestamptz,
  touches_created    integer not null default 0,
  accounts_advanced  integer not null default 0,
  drafts_blocked     integer not null default 0,  -- count of drafts the quality guardrails refused to queue
  status             text not null check (status in ('ok','error')),
  error_message      text
);

-- ---------- draft_generations ----------
-- One row per draft-generation ATTEMPT (queued or blocked), for full
-- prompt+output traceability — see src/guardrails.js and src/interpolate.js.

create table draft_generations (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  account_id    text references accounts(id),
  stage         text not null,
  prompt_input  jsonb not null default '{}',
  raw_output    jsonb not null default '{}',
  final_output  jsonb not null default '{}',
  valid         boolean not null,
  errors        jsonb not null default '[]'
);

-- ---------- sends (full send audit — Prompt 8 Item 6) ----------
-- One row per actual email send: who clicked Approve & Send, when, and
-- whether the draft was edited first. Distinct from touches (current
-- state of one drafted item) and activity (human-readable feed) — this is
-- the compliance-relevant audit trail purpose-built for the dashboard.

create table sends (
  id                uuid primary key default gen_random_uuid(),
  touch_id          uuid not null references touches(id),
  account_id        text not null references accounts(id),
  owner_id          text not null references owners(id),  -- whose Gmail it went out through
  sent_by           text not null references users(id),   -- who clicked Approve & Send
  was_edited        boolean not null default false,
  gmail_message_id  text,
  at                timestamptz not null default now()
);

-- ---------- settings (Prompt 9 — pilot checkpoint mode) ----------
-- A generic key-value store rather than a single hardcoded column, since
-- a pilot process tends to grow more than one manual toggle over time.

create table settings (
  key   text primary key,
  value jsonb not null
);

-- ---------- checkpoints (Prompt 9 Item 3 — manual gate during the pilot's
-- observation window) ----------
-- While settings['checkpointMode'] is true, the engine proposes a stage
-- transition here instead of drafting it directly.

create table checkpoints (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null references accounts(id),
  funnel      text not null check (funnel in ('win_back','proposal_follow_up','nurture')),
  stage       text not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  decided_by  text references users(id),
  decided_at  timestamptz,
  reason      text
);

create index checkpoints_status_idx on checkpoints(status);
create index checkpoints_account_idx on checkpoints(account_id);

-- ---------- draft_feedback (Prompt 10 Item 3) ----------
-- A lightweight way for Audrey or Nick to flag a specific bad draft with a
-- reason — rolls up into monthly_reviews.feedback_summary below and is
-- meant to feed future prompt tuning for the drafting engine (Prompt 6).

create table draft_feedback (
  id          uuid primary key default gen_random_uuid(),
  touch_id    uuid not null references touches(id),
  account_id  text not null references accounts(id),
  owner_id    text not null references owners(id),
  flagged_by  text not null references users(id),
  category    text not null check (category in ('tone','factual_accuracy','wrong_cta','links','other')),
  reason      text not null,
  at          timestamptz not null default now()
);

create index draft_feedback_at_idx on draft_feedback(at desc);
create index draft_feedback_category_idx on draft_feedback(category);

-- ---------- monthly_reviews (Prompt 10 Item 1) ----------
-- One row per generated review, kept indefinitely — this history is what
-- lets the review process (src/reviews.js) detect a metric missing target
-- TWO reviews running (Item 2's escalation trigger), not just the current
-- moment. `targets` mirrors dashboard.js's threshold block verbatim, so
-- there is exactly one place Prompt 3's target/kill judgments are computed.

create table monthly_reviews (
  id                 uuid primary key default gen_random_uuid(),
  period_label       text not null,       -- 'YYYY-MM'
  generated_at       timestamptz not null default now(),
  targets            jsonb not null,      -- dashboard.js's thresholds block for this period
  draft_edit_rate    jsonb not null,      -- { totalSends, editedSends, rate }
  opt_out_trend      jsonb not null,      -- { newOptOutsLast30d, totalOptedOut, totalEverSynced, cumulativeRate }
  feedback_summary   jsonb not null,      -- { totalFlags, byCategory }
  escalations        jsonb not null default '[]'
);

create index monthly_reviews_period_idx on monthly_reviews(period_label);

-- ---------- calendly_events (webhook delivery idempotency) ----------
-- Webhooks are commonly delivered more than once for the same booking — a
-- retry after a slow/failed response, or a genuine provider replay. This
-- is the dedup record: one row per invitee event URI actually processed,
-- so a replayed delivery is acknowledged without re-running rebookAccount.

create table calendly_events (
  event_key   text primary key,   -- the invitee's Calendly resource URI
  processed_at timestamptz not null default now()
);

create index sends_account_idx on sends(account_id);
create index sends_at_idx on sends(at desc);

create index sync_runs_at_idx on sync_runs(at desc);
create index engine_runs_at_idx on engine_runs(at desc);
create index draft_generations_account_id_idx on draft_generations(account_id);
create index draft_generations_at_idx on draft_generations(at desc);

-- ---------- seed owners ----------
-- Inserted without backup_for first, then cross-linked, since it's a
-- self-referencing FK and neither row can point at the other before both exist.

insert into owners (id, name) values ('audrey', 'Audrey'), ('nick', 'Nick');
update owners set backup_for = 'nick' where id = 'audrey';
update owners set backup_for = 'audrey' where id = 'nick';

-- ---------- seed users ----------

insert into users (id, name, role) values
  ('shawn', 'Shawn', 'admin'),
  ('ira', 'Ira', 'admin'),
  ('audrey', 'Audrey', 'viewer'),
  ('nick', 'Nick', 'viewer');
