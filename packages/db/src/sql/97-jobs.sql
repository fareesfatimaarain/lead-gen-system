-- ============================================================================
-- Job leasing.
--
-- The worker has to pull work across every tenant, but it connects as the same
-- NOBYPASSRLS role as the web app — which, correctly, can see no row without an
-- org claim. Rather than punch a hole in the isolation model or hand the worker
-- a superuser connection, cross-tenant access is confined to this one function.
--
-- It is SECURITY DEFINER, so its body runs with the owner's rights, and its body
-- is a single fixed statement that touches exactly one table and returns only
-- queue bookkeeping. There is no parameter that can widen what it reads. The
-- worker then does the actual work inside `withOrg(job.org_id)`, back under RLS.
--
-- `FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe: each row is
-- handed to exactly one claimer, and a worker that dies holding a lease has its
-- jobs re-offered once `lease_until` passes rather than stranding them.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.claim_jobs(
  p_queue          text,
  p_worker         text,
  p_limit          int,
  p_lease_seconds  int
) RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_jobs: p_limit must be between 1 and 100, got %', p_limit;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'claim_jobs: p_lease_seconds must be positive, got %', p_lease_seconds;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.queue = p_queue
      AND (
            (j.status = 'queued'  AND j.run_at <= now())
        -- A lease that has expired means the worker holding it is gone.
        OR  (j.status = 'running' AND j.lease_until < now())
      )
    ORDER BY j.priority ASC, j.run_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs j
     SET status      = 'running',
         attempts    = j.attempts + 1,
         locked_at   = now(),
         locked_by   = p_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         started_at  = COALESCE(j.started_at, now()),
         updated_at  = now()
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END $$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which for a
-- SECURITY DEFINER function is exactly the wrong default. Revoke, then grant
-- only to the unprivileged login roles the application uses.
REVOKE ALL ON FUNCTION app.claim_jobs(text, text, int, int) FROM PUBLIC;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles
    WHERE rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION app.claim_jobs(text, text, int, int) TO %I', r.rolname);
  END LOOP;
END $$;
