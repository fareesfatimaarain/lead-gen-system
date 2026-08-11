-- Applied before the generated migrations, because the trigram indexes on
-- companies.name and prospects.full_name depend on pg_trgm existing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy prospect/company search

-- Helper namespace. Kept out of `public` so nothing here is accidentally
-- exposed by a schema-reflecting API layer.
CREATE SCHEMA IF NOT EXISTS app;

-- The request-scoped tenant claim. Set by the API on each transaction from the
-- server-side session, never from client input. Every RLS policy resolves
-- through this function.
--
-- Returns NULL when unset, and `org_id = NULL` is never true, so an
-- unconfigured connection sees zero rows rather than all of them. That is the
-- fail-closed property the whole isolation model rests on.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- updated_at maintenance, applied by trigger to every table that has the column.
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
