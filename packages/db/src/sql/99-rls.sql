-- ============================================================================
-- Row-level security.
--
-- Applied after the generated migrations, and idempotent — re-running it is
-- safe and is how a newly added table gets its policy.
--
-- FORCE ROW LEVEL SECURITY is the important part: without it, policies are
-- skipped for the table owner, which is the role the application connects as.
-- With it, isolation holds even for the owner, so a route that forgets its
-- WHERE clause returns nothing rather than another customer's data.
--
-- Deliberate exception: orgs, users, org_members and sessions.
-- A user belongs to many orgs, so these cannot carry a single org_id predicate.
-- They get membership-derived SELECT policies but are NOT forced, because the
-- auth layer has to create a user and an org before any membership row exists.
-- Those four tables are written by exactly one module (src/auth-queries.ts),
-- which always scopes by the server-side session. Treat that module as
-- security-critical code.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'credentials','settings','icps','proof_assets','sequences','sequence_steps',
    'mailboxes','campaigns','campaign_mailboxes','companies','prospects',
    'prospect_signals','prospect_scores','activities','emails','email_replies',
    'calls','bookings','source_performance','data_sources','jobs_log','jobs','discovery_runs',
    'enrichment_attempts','agent_runs','provider_usage','guardrail_events',
    'audit_log'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'RLS target table % does not exist — schema and RLS list are out of sync', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        USING (org_id = app.current_org_id())
        WITH CHECK (org_id = app.current_org_id())
    $f$, t);
  END LOOP;
END $$;

-- Suppressions are the one org-scoped table with a second rule: an org sees its
-- own rows PLUS every global row, and may only write its own. Global rows are
-- national DNC lists and platform-wide opt-outs, managed out of band.
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.suppressions;
DROP POLICY IF EXISTS suppressions_read ON public.suppressions;
DROP POLICY IF EXISTS suppressions_write ON public.suppressions;

CREATE POLICY suppressions_read ON public.suppressions
  FOR SELECT USING (org_id = app.current_org_id() OR org_id IS NULL);

CREATE POLICY suppressions_write ON public.suppressions
  FOR ALL
  USING (org_id = app.current_org_id())
  WITH CHECK (org_id = app.current_org_id());

-- ---------------------------------------------------------------------------
-- Tenancy-exception tables: orgs, users, org_members, sessions.
--
-- RLS is deliberately NOT enabled on these four, and the reason is worth
-- stating plainly rather than leaving as an oversight.
--
-- 1. Sign-in is inherently pre-authentication. `getSession()` looks a session up
--    by token hash before it knows which user it belongs to, so there is no
--    claim to filter on yet. A policy strict enough to be worth having would
--    make sign-in impossible.
-- 2. Sign-up writes a user, an org, and a membership in one transaction. No
--    membership exists while the first two rows are being written, so a
--    membership-derived policy cannot authorize its own bootstrap.
-- 3. A membership policy that reads `org_members` to decide access to
--    `org_members` recurses — Postgres rejects it outright.
--
-- The compensating control is a hard boundary, not a hope: these four tables are
-- read and written by exactly one module, `apps/web/src/lib/session.ts`, which
-- always scopes by the server-side session token or the resolved user id. Treat
-- that file as security-critical. Anything reading them from elsewhere is a bug.
--
-- No customer data lives here — no prospects, no messages, no credentials. Every
-- table that holds any is in the FORCE list above.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orgs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orgs_member_read ON public.orgs;
DROP POLICY IF EXISTS users_self_or_coworker ON public.users;
DROP POLICY IF EXISTS org_members_same_org ON public.org_members;
DROP POLICY IF EXISTS sessions_self ON public.sessions;

-- ---------------------------------------------------------------------------
-- Assertion: every table carrying an org_id must be forced.
--
-- Adding a tenant table and forgetting to list it above would leave customer
-- data with no isolation at all, and nothing would fail until it leaked. This
-- turns that into a migration error.
-- ---------------------------------------------------------------------------

DO $$
DECLARE unprotected text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    -- The documented exception. `org_members` carries an org_id but is an auth
    -- table, not a data table; see the note above for why it cannot be policed.
    AND c.relname <> 'org_members'
    AND NOT c.relforcerowsecurity;

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'These tables have an org_id but no forced row-level security: %', unprotected;
  END IF;
END $$;
