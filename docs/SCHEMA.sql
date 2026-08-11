-- ############################################################################
-- SUPERSEDED — kept for the design rationale in the comments below.
--
-- The schema is now defined in TypeScript at packages/db/src/schema/, and that
-- is the single source of truth. `npm run db:generate` produces the real DDL at
-- packages/db/migrations/, which is what actually runs.
--
-- Two schemas would drift, and a drifted schema doc is worse than none. Read
-- this file for *why* a table looks the way it does; read the Drizzle schema for
-- what it is.
--
-- Known differences from what shipped:
--   * citext was dropped. Emails and domains are `text`, lowercased by the
--     application (the zod schemas in packages/shared do it at the boundary).
--     One fewer extension, and identical behaviour.
--   * The RLS model changed materially — see docs/PHASE1.md § Row-level
--     security, and packages/db/src/sql/99-rls.sql for the version that runs.
--     In short: policies here were written for orgs/users/org_members/sessions
--     too; those turned out to be unpolicable and are now a documented,
--     single-writer exception.
--   * A second, unprivileged database role was added. Without it every policy
--     in this file was inert. See docs/PHASE1.md.
-- ############################################################################

-- =============================================================================
-- Master Outreach System — Postgres schema
-- Version: 0.1 (pre-approval draft)
-- Companion: docs/ARCHITECTURE.md, docs/EXISTING_AUDIT.md
--
-- Conventions
--   * uuid primary keys, generated server-side
--   * timestamptz everywhere, always UTC; prospect-local time is derived at
--     read time from prospects.timezone, never stored pre-localized
--   * every tenant table carries org_id and is protected by RLS
--   * money is numeric(14,6) — LLM and provider costs are sub-cent
--   * jsonb for provider payloads we must keep verbatim; typed columns for
--     anything the app queries or filters on
--
-- Tenancy exception, stated deliberately: orgs, users and org_members cannot
-- carry an org_id predicate in the same way (a user belongs to many orgs).
-- They are secured by membership-derived policies instead. Every other table
-- follows the org_id + RLS rule without exception.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";     -- prospect/company fuzzy search
create extension if not exists "citext";      -- case-insensitive email dedup

-- Helper namespace, kept out of public so nothing here is exposed via PostgREST.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Request-scoped tenant claim. Set by the API per request from the session,
-- never from client input. All RLS policies resolve through this.
-- -----------------------------------------------------------------------------
create or replace function app.current_org_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create or replace function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;


-- =============================================================================
-- ENUMS
-- =============================================================================

create type org_role            as enum ('owner', 'operator', 'viewer');

create type credential_status   as enum ('unverified', 'active', 'failing', 'revoked');

create type campaign_status     as enum ('draft', 'active', 'paused', 'completed', 'archived');

create type step_type           as enum ('email', 'call', 'wait', 'manual_task', 'branch');

create type prospect_status     as enum (
  'discovered', 'enriching', 'enriched', 'needs_review', 'qualified',
  'queued', 'contacted', 'engaged', 'meeting_booked', 'won',
  'disqualified', 'unsubscribed', 'bounced', 'do_not_contact'
);

create type activity_type       as enum (
  'email_sent', 'email_opened', 'email_replied', 'email_bounced',
  'call_placed', 'call_connected', 'call_completed', 'call_voicemail',
  'note', 'status_change', 'task', 'guardrail_block'
);

create type email_direction     as enum ('outbound', 'inbound');

create type email_state         as enum (
  'draft', 'pending_approval', 'approved', 'rejected', 'queued',
  'sent', 'delivered', 'bounced', 'complained', 'failed'
);

create type reply_intent        as enum (
  'interested', 'question', 'objection', 'referral', 'not_now',
  'not_interested', 'unsubscribe', 'auto_reply', 'bounce', 'unknown'
);

create type call_disposition    as enum (
  'answered', 'no_answer', 'voicemail', 'gatekeeper',
  'wrong_number', 'failed', 'declined_permission'
);

create type suppression_scope   as enum ('org', 'global');
create type suppression_kind    as enum ('email', 'domain', 'phone');

create type mailbox_status      as enum ('connecting', 'warming', 'healthy', 'paused', 'failed');

create type verification_result as enum ('valid', 'invalid', 'catch_all', 'risky', 'unknown');


-- =============================================================================
-- TENANCY
-- =============================================================================

create table orgs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  citext not null unique,
  -- Auto-send unlock gate (brief §4.6): auto-send is opt-in per campaign and
  -- only unlockable after 25 human approvals in this org.
  approved_draft_count  integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  name          text,
  auth_provider text,
  auth_subject  text,
  created_at    timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);

create table org_members (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index on org_members (user_id);


-- =============================================================================
-- CREDENTIALS  (brief §3 — encrypted at rest, never returned in plaintext)
-- =============================================================================

create table credentials (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  provider         text not null,              -- registry key, e.g. 'vapi', 'resend'
  label            text not null,
  -- AES-256-GCM. Ciphertext, IV and auth tag stored separately so a partial
  -- read can never be mistaken for a decryptable value. Key lives in the server
  -- environment and is the ONLY secret that stays in env.
  encrypted_value  bytea not null,
  encryption_iv    bytea not null,
  encryption_tag   bytea not null,
  key_version      smallint not null default 1,
  -- Non-secret display fragment, e.g. 'sk-…4f2a'. Safe to return to the client.
  masked_hint      text not null,
  -- Non-secret provider config (region, from-domain, account id, …)
  config           jsonb not null default '{}'::jsonb,
  status           credential_status not null default 'unverified',
  last_verified_at timestamptz,
  last_error       text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, provider, label)
);

create index on credentials (org_id, provider);


-- =============================================================================
-- SETTINGS  (brief §6 — per-org sending policy and guardrail thresholds)
-- =============================================================================

create table settings (
  org_id                     uuid primary key references orgs(id) on delete cascade,

  -- Volume and reputation
  mailbox_daily_cap          integer not null default 40,
  warmup_weeks               integer not null default 4,
  send_interval_min_seconds  integer not null default 240,
  send_interval_max_seconds  integer not null default 1800,   -- randomized, never fixed
  bounce_rate_pause_pct      numeric(5,3) not null default 3.000,
  complaint_rate_pause_pct   numeric(5,3) not null default 0.100,

  -- Frequency and consent
  max_emails_per_prospect    integer not null default 4,
  max_calls_per_prospect     integer not null default 2,
  cross_campaign_cooldown_days integer not null default 90,
  one_contact_per_company    boolean not null default true,
  call_window_start_hour     smallint not null default 9,     -- prospect-local
  call_window_end_hour       smallint not null default 18,
  min_days_between_calls     integer not null default 4,
  max_voicemails             integer not null default 2,
  send_on_weekends           boolean not null default false,
  respect_public_holidays    boolean not null default true,

  -- Content
  banned_phrases             text[] not null default array[
    'quick question', 'circling back', 'just bumping', 'bumping this to the top',
    'hope this finds you well', 'I was so impressed', E'Love what you\'re doing at',
    'reaching out', 'touch base', 'synergy', 'game changer'
  ],
  max_first_touch_words      integer not null default 120,
  min_signal_confidence      numeric(3,2) not null default 0.70,
  spam_score_threshold       numeric(5,2) not null default 5.00,
  open_tracking_enabled      boolean not null default false,  -- off by default, brief §6

  -- Qualification
  min_icp_fit_score          integer not null default 60,

  -- Approval
  approval_mode_default      boolean not null default true,

  -- Spend
  monthly_spend_cap_usd      numeric(12,2),
  spend_hard_cutoff          boolean not null default true,

  -- Compliance
  call_recording_disclosure  text,
  jurisdiction               text,

  -- Per-agent model selection: { "message_composer": "claude-opus-5", ... }
  agent_models               jsonb not null default '{}'::jsonb,

  updated_at                 timestamptz not null default now()
);


-- =============================================================================
-- ICP  (brief §3 — structured, not a blob. This is the heart of the product.)
-- =============================================================================

create table icps (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  name              text not null,
  description       text,

  -- Firmographics
  industries        text[] not null default '{}',
  sub_industries    text[] not null default '{}',
  company_size_bands text[] not null default '{}',           -- '1-10','11-50',…
  revenue_bands     text[] not null default '{}',
  geographies       jsonb not null default '[]'::jsonb,      -- [{country,region,city,radius_km}]
  tech_stack        text[] not null default '{}',
  business_models   text[] not null default '{}',            -- b2b, b2c, marketplace, …

  -- Persona
  titles            text[] not null default '{}',
  seniority_levels  text[] not null default '{}',
  departments       text[] not null default '{}',
  decision_role     text,                                     -- decision_maker | influencer | champion
  exclusion_titles  text[] not null default '{}',

  -- Qualifying signals: [{type,label,weight,lookback_days}]
  qualifying_signals jsonb not null default '[]'::jsonb,

  -- Disqualifiers (hard excludes)
  excluded_domains    text[] not null default '{}',
  excluded_industries text[] not null default '{}',
  excluded_company_ids uuid[] not null default '{}',
  competitor_domains  text[] not null default '{}',

  -- Value hypothesis — free text, consumed by the message composer
  pain_hypothesis   text,
  value_proposition text,

  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, name)
);

-- Proof assets, tagged by which ICP segment they support
create table proof_assets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  icp_id       uuid references icps(id) on delete cascade,     -- null = applies to all
  kind         text not null,                                  -- case_study | metric | reference | testimonial
  title        text not null,
  body         text not null,
  metric_value text,
  source_url   text,
  segment_tags text[] not null default '{}',
  created_at   timestamptz not null default now()
);

create index on proof_assets (org_id, icp_id);


-- =============================================================================
-- SEQUENCES AND CAMPAIGNS
-- =============================================================================

create table sequences (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  sequence_id   uuid not null references sequences(id) on delete cascade,
  position      integer not null,
  type          step_type not null,
  delay_hours   integer not null default 0,      -- after the previous step completes
  -- Branch/skip conditions, e.g. {"if":"opened_count>=3","then":"promote_call"}
  conditions    jsonb not null default '{}'::jsonb,
  -- Step-level guidance for the composer / call agent. Never a literal template.
  instruction   text,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (sequence_id, position)
);

create index on sequence_steps (org_id, sequence_id);

create table mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  email               citext not null,
  display_name        text,
  send_credential_id  uuid references credentials(id) on delete set null,
  recv_credential_id  uuid references credentials(id) on delete set null,
  status              mailbox_status not null default 'connecting',

  -- Domain auth — a campaign cannot activate until all three pass (brief §6)
  spf_pass            boolean,
  dkim_pass           boolean,
  dmarc_pass          boolean,
  domain_checked_at   timestamptz,

  -- Warmup and health
  warmup_started_at   timestamptz,
  current_daily_cap   integer not null default 10,
  sent_today          integer not null default 0,
  sent_today_date     date,
  bounce_rate_pct     numeric(5,3) not null default 0,
  complaint_rate_pct  numeric(5,3) not null default 0,
  paused_reason       text,
  last_send_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, email)
);

create table campaigns (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  name              text not null,
  status            campaign_status not null default 'draft',
  icp_id            uuid not null references icps(id) on delete restrict,
  sequence_id       uuid not null references sequences(id) on delete restrict,

  -- Policy overrides on top of settings; null = inherit org default
  policy_overrides  jsonb not null default '{}'::jsonb,

  -- Auto-send is opt-in per campaign AND gated on orgs.approved_draft_count >= 25
  auto_send_enabled boolean not null default false,
  call_first        boolean not null default false,   -- brief §5 exception

  activated_at      timestamptz,
  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, name)
);

create index on campaigns (org_id, status);

create table campaign_mailboxes (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  mailbox_id  uuid not null references mailboxes(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  primary key (campaign_id, mailbox_id)
);


-- =============================================================================
-- PROSPECTS
-- =============================================================================

create table companies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  name           text not null,
  domain         citext,                       -- dedup key
  website_url    text,
  linkedin_url   text,
  industry       text,
  sub_industry   text,
  employee_count integer,
  size_band      text,
  revenue_band   text,
  country        text,
  region         text,
  city           text,
  timezone       text,
  tech_stack     text[] not null default '{}',
  description    text,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Dedup on domain within an org; partial so domain-less records are allowed
create unique index companies_org_domain_uniq on companies (org_id, domain)
  where domain is not null;
create index companies_name_trgm on companies using gin (name gin_trgm_ops);

create table prospects (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  company_id          uuid references companies(id) on delete set null,
  campaign_id         uuid references campaigns(id) on delete set null,

  first_name          text,
  last_name           text,
  full_name           text,
  title               text,
  seniority           text,
  department          text,

  email               citext,
  email_verification  verification_result not null default 'unknown',
  email_verified_at   timestamptz,
  phone               text,                    -- E.164
  phone_type          text,                    -- direct | mobile | switchboard
  linkedin_url        text,

  timezone            text,                    -- drives all prospect-local timing
  country             text,
  city                text,

  status              prospect_status not null default 'discovered',
  status_reason       text,

  -- Referral chain (brief §4.8)
  referred_by_prospect_id uuid references prospects(id) on delete set null,

  -- Orchestrator bookkeeping
  current_step_position integer,
  next_action_at        timestamptz,
  next_action_type      step_type,
  paused_by_human_reply boolean not null default false,
  emails_sent_count     integer not null default 0,
  calls_placed_count    integer not null default 0,
  voicemails_left_count integer not null default 0,
  opens_count           integer not null default 0,
  last_contacted_at     timestamptz,

  source              text,
  source_url          text,
  discovered_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Dedup keys (brief §3): email, and linkedin_url
create unique index prospects_org_email_uniq on prospects (org_id, email)
  where email is not null;
create unique index prospects_org_linkedin_uniq on prospects (org_id, linkedin_url)
  where linkedin_url is not null;

create index on prospects (org_id, status);
create index on prospects (org_id, campaign_id, status);
create index on prospects (org_id, company_id);
-- Drives the orchestrator's "what is due" scan
create index prospects_due_idx on prospects (org_id, next_action_at)
  where next_action_at is not null;
create index prospects_name_trgm on prospects using gin (full_name gin_trgm_ops);


-- The anti-hallucination mechanism. Nothing is used in a message unless it
-- exists here with a source_url and confidence >= settings.min_signal_confidence.
create table prospect_signals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  prospect_id    uuid references prospects(id) on delete cascade,
  company_id     uuid references companies(id) on delete cascade,
  type           text not null,      -- funding | hiring | leadership_change | news | positioning | post | review_theme | gap | call_fact
  category       text,               -- grouping for the intel panel
  value          text not null,
  source_url     text not null,      -- NOT NULL. No source, no signal.
  source_name    text,
  confidence     numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  discovered_at  timestamptz not null default now(),
  discovered_by  text,               -- agent id, or 'call:<call_id>'
  raw            jsonb,
  created_at     timestamptz not null default now(),
  check (prospect_id is not null or company_id is not null)
);

create index on prospect_signals (org_id, prospect_id, confidence desc);
create index on prospect_signals (org_id, company_id);
create index on prospect_signals (org_id, type);

create table prospect_scores (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id) on delete cascade,
  prospect_id        uuid not null references prospects(id) on delete cascade,
  icp_id             uuid not null references icps(id) on delete cascade,
  icp_fit_score      integer not null check (icp_fit_score between 0 and 100),
  intent_score       integer not null default 0 check (intent_score between 0 and 100),
  reachability_score integer not null default 0 check (reachability_score between 0 and 100),
  -- Per-criterion breakdown the user can see and dispute (brief §4.5):
  -- [{criterion,weight,matched,evidence_signal_id,note}]
  breakdown          jsonb not null default '[]'::jsonb,
  reasoning          text,
  model              text,
  scored_at          timestamptz not null default now(),
  unique (prospect_id, icp_id)
);

create index on prospect_scores (org_id, icp_fit_score desc);


-- =============================================================================
-- ACTIVITY
-- =============================================================================

create table activities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  prospect_id   uuid not null references prospects(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete set null,
  type          activity_type not null,
  -- Polymorphic pointer to emails/calls/email_replies; type tells you which
  subject_table text,
  subject_id    uuid,
  actor         text,                 -- 'system' | 'agent:<id>' | 'user:<uuid>'
  summary       text,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);

-- The prospect-profile timeline query
create index activities_timeline_idx on activities (org_id, prospect_id, occurred_at desc);
create index on activities (org_id, campaign_id, occurred_at desc);
create index on activities (org_id, type, occurred_at desc);

create table emails (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  prospect_id         uuid not null references prospects(id) on delete cascade,
  campaign_id         uuid references campaigns(id) on delete set null,
  sequence_step_id    uuid references sequence_steps(id) on delete set null,
  mailbox_id          uuid references mailboxes(id) on delete set null,

  direction           email_direction not null default 'outbound',
  state               email_state not null default 'draft',

  subject             text not null,
  body_text           text not null,
  body_html           text,

  thread_id           text,
  message_id          text,
  in_reply_to         text,
  provider            text,
  provider_message_id text,

  -- Traceability (brief §4.6): why the composer wrote what it wrote, and which
  -- signals it was allowed to cite.
  reasoning           text,
  cited_signal_ids    uuid[] not null default '{}',
  proof_asset_id      uuid references proof_assets(id) on delete set null,
  model               text,
  generation_cost_usd numeric(14,6),
  validator_report    jsonb not null default '{}'::jsonb,
  regeneration_count  integer not null default 0,

  approved_by         uuid references users(id) on delete set null,
  approved_at         timestamptz,
  scheduled_for       timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  bounced_at          timestamptz,
  bounce_type         text,
  opens_count         integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on emails (org_id, prospect_id, created_at desc);
create index on emails (org_id, state) where state in ('pending_approval','queued');
create index on emails (org_id, thread_id);
create unique index emails_provider_msg_uniq on emails (org_id, provider, provider_message_id)
  where provider_message_id is not null;

create table email_replies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  prospect_id       uuid not null references prospects(id) on delete cascade,
  email_id          uuid references emails(id) on delete set null,   -- the email replied to
  thread_id         text,
  message_id        text,
  from_email        citext not null,
  raw_body          text not null,
  parsed_body       text,                    -- quoted history stripped
  intent            reply_intent not null default 'unknown',
  sentiment         numeric(3,2),
  classification_reasoning text,
  model             text,
  -- OOO handling (brief §4.8)
  ooo_return_date   date,
  -- Referral handling
  referred_name     text,
  referred_email    citext,
  created_prospect_id uuid references prospects(id) on delete set null,
  handled_by        uuid references users(id) on delete set null,
  handled_at        timestamptz,
  received_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index on email_replies (org_id, prospect_id, received_at desc);
create index on email_replies (org_id, intent) where handled_at is null;

create table calls (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  prospect_id       uuid not null references prospects(id) on delete cascade,
  campaign_id       uuid references campaigns(id) on delete set null,
  sequence_step_id  uuid references sequence_steps(id) on delete set null,

  provider          text not null default 'vapi',
  vapi_call_id      text,
  phone_number_id   text,
  assistant_config  jsonb,             -- the per-prospect overrides actually sent

  status            text,              -- queued | ringing | in_progress | ended
  ended_reason      text,
  disposition       call_disposition,
  duration_seconds  integer,
  recording_url     text,

  -- Turn-by-turn: [{role, text, started_at, ended_at}]
  transcript        jsonb,
  transcript_text   text,              -- flattened, for search
  summary           text,
  sentiment         numeric(3,2),
  objections        jsonb not null default '[]'::jsonb,
  commitments       jsonb not null default '[]'::jsonb,
  next_step         text,
  permission_granted boolean,          -- did they agree to continue after the ask
  voicemail_left    boolean not null default false,
  callback_requested_at timestamptz,

  cost_usd          numeric(14,6),
  raw_payload       jsonb,

  started_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index calls_vapi_uniq on calls (org_id, vapi_call_id)
  where vapi_call_id is not null;
create index on calls (org_id, prospect_id, created_at desc);
create index on calls (org_id, campaign_id, created_at desc);

create table bookings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  prospect_id  uuid references prospects(id) on delete set null,
  campaign_id  uuid references campaigns(id) on delete set null,
  call_id      uuid references calls(id) on delete set null,
  provider     text not null default 'calcom',
  provider_booking_id text,
  start_time   timestamptz,
  attendee_name  text,
  attendee_email citext,
  status       text not null default 'confirmed',
  raw          jsonb,
  created_at   timestamptz not null default now()
);

create index on bookings (org_id, start_time);


-- =============================================================================
-- SUPPRESSIONS  (brief §3 — org-scoped and global)
-- =============================================================================

create table suppressions (
  id          uuid primary key default gen_random_uuid(),
  -- org_id null == global suppression, visible to every org
  org_id      uuid references orgs(id) on delete cascade,
  scope       suppression_scope not null default 'org',
  kind        suppression_kind not null,
  value       citext not null,          -- email, domain, or E.164 phone
  reason      text not null,
  source      text,                     -- 'reply:unsubscribe' | 'call:not_interested' | 'dnc_import' | 'manual'
  source_id   uuid,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((scope = 'global' and org_id is null) or (scope = 'org' and org_id is not null))
);

create unique index suppressions_org_uniq on suppressions (org_id, kind, value)
  where org_id is not null;
create unique index suppressions_global_uniq on suppressions (kind, value)
  where org_id is null;
-- The guardrail hot path
create index suppressions_lookup_idx on suppressions (kind, value);


-- =============================================================================
-- SOURCE PERFORMANCE  (brief §4.1 — feedback so future runs re-rank)
-- =============================================================================

create table source_performance (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  icp_id            uuid references icps(id) on delete cascade,
  source            text not null,
  query             text,
  leads_returned    integer not null default 0,
  leads_new         integer not null default 0,
  leads_qualified   integer not null default 0,
  avg_fit_score     numeric(5,2),
  cost_usd          numeric(14,6) not null default 0,
  latency_ms        integer,
  error             text,
  ran_at            timestamptz not null default now()
);

create index on source_performance (org_id, icp_id, source, ran_at desc);


-- =============================================================================
-- OPS
-- =============================================================================

create table jobs_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  queue        text not null,
  job_name     text not null,
  job_id       text not null,          -- BullMQ idempotency key
  status       text not null,          -- queued | active | completed | failed | dead
  attempt      integer not null default 1,
  payload      jsonb,
  result       jsonb,
  error        text,
  duration_ms  integer,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index on jobs_log (org_id, queue, created_at desc);
create index on jobs_log (org_id, status) where status in ('failed','dead');
create unique index jobs_log_job_uniq on jobs_log (queue, job_id, attempt);

create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  agent          text not null,        -- source_strategist | research | composer | …
  prospect_id    uuid references prospects(id) on delete set null,
  campaign_id    uuid references campaigns(id) on delete set null,
  model          text not null,
  input          jsonb not null,
  output         jsonb,
  schema_valid   boolean,
  repair_attempted boolean not null default false,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(14,6),
  latency_ms     integer,
  error          text,
  created_at     timestamptz not null default now()
);

create index on agent_runs (org_id, created_at desc);
create index on agent_runs (org_id, agent, created_at desc);
create index on agent_runs (org_id, prospect_id);

create table provider_usage (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  provider    text not null,
  operation   text not null,
  units       integer not null default 1,
  cost_usd    numeric(14,6) not null default 0,
  period      date not null default current_date,
  created_at  timestamptz not null default now()
);

create index on provider_usage (org_id, period, provider);

-- Every guardrail denial. Feeds the Sending Health panel's "why is nothing
-- sending" answer. A denial is never silent (ARCHITECTURE §9).
create table guardrail_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  mailbox_id  uuid references mailboxes(id) on delete set null,
  channel     text not null,           -- email | call
  rule        text not null,
  reason      text not null,
  retry_after timestamptz,
  created_at  timestamptz not null default now()
);

create index on guardrail_events (org_id, created_at desc);
create index on guardrail_events (org_id, rule, created_at desc);

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid references users(id) on delete set null,
  action      text not null,           -- credential.read | campaign.activate | suppression.delete | …
  entity      text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index on audit_log (org_id, created_at desc);
create index on audit_log (org_id, action, created_at desc);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table orgs                enable row level security;
alter table users               enable row level security;
alter table org_members         enable row level security;
alter table credentials         enable row level security;
alter table settings            enable row level security;
alter table icps                enable row level security;
alter table proof_assets        enable row level security;
alter table sequences           enable row level security;
alter table sequence_steps      enable row level security;
alter table mailboxes           enable row level security;
alter table campaigns           enable row level security;
alter table campaign_mailboxes  enable row level security;
alter table companies           enable row level security;
alter table prospects           enable row level security;
alter table prospect_signals    enable row level security;
alter table prospect_scores     enable row level security;
alter table activities          enable row level security;
alter table emails              enable row level security;
alter table email_replies       enable row level security;
alter table calls               enable row level security;
alter table bookings            enable row level security;
alter table suppressions        enable row level security;
alter table source_performance  enable row level security;
alter table jobs_log            enable row level security;
alter table agent_runs          enable row level security;
alter table provider_usage      enable row level security;
alter table guardrail_events    enable row level security;
alter table audit_log           enable row level security;

-- Standard tenant policy, applied to every org-scoped table.
do $$
declare t text;
begin
  foreach t in array array[
    'credentials','settings','icps','proof_assets','sequences','sequence_steps',
    'mailboxes','campaigns','campaign_mailboxes','companies','prospects',
    'prospect_signals','prospect_scores','activities','emails','email_replies',
    'calls','bookings','source_performance','jobs_log','agent_runs',
    'provider_usage','guardrail_events','audit_log'
  ] loop
    execute format($f$
      create policy tenant_isolation on %I
        using (org_id = app.current_org_id())
        with check (org_id = app.current_org_id());
    $f$, t);
  end loop;
end $$;

-- Suppressions: an org sees its own rows plus every global row, and may only
-- write its own. Global rows are managed by the service role.
create policy suppressions_read on suppressions
  for select using (org_id = app.current_org_id() or org_id is null);
create policy suppressions_write on suppressions
  for all using (org_id = app.current_org_id())
  with check (org_id = app.current_org_id());

-- Tenancy-exception tables (see header note).
create policy orgs_member_read on orgs
  for select using (
    exists (select 1 from org_members m
            where m.org_id = orgs.id and m.user_id = app.current_user_id())
  );

create policy users_self_or_coworker on users
  for select using (
    users.id = app.current_user_id()
    or exists (
      select 1 from org_members m1
      join org_members m2 on m1.org_id = m2.org_id
      where m1.user_id = app.current_user_id() and m2.user_id = users.id
    )
  );

create policy org_members_same_org on org_members
  for select using (
    exists (select 1 from org_members m
            where m.org_id = org_members.org_id and m.user_id = app.current_user_id())
  );


-- =============================================================================
-- TRIGGERS
-- =============================================================================

create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orgs','credentials','icps','sequences','mailboxes','campaigns',
    'companies','prospects','emails','calls'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function app.touch_updated_at();',
      t, t);
  end loop;
end $$;
