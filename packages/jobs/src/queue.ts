import { and, eq, inArray, schema, sql } from "@outreach/db";
import type { Tx } from "@outreach/db";
import type { Queue } from "@outreach/shared";
import { backoffSeconds } from "./backoff";

/**
 * The queue API.
 *
 * Everything here takes a transaction handle rather than opening its own. That
 * is the whole reason the queue lives in Postgres: `enqueue()` inside the same
 * transaction that writes the domain row means a job can never reference
 * something that was rolled back, and a rolled-back job can never leave a
 * phantom send scheduled.
 */

export interface EnqueueInput {
  orgId: string;
  queue: Queue;
  name: string;
  /**
   * Idempotency key, derived from the domain event rather than random. Enqueuing
   * the same key twice is a no-op — this is what makes "one email per step"
   * survive a retry, a redeploy, or a duplicate provider webhook.
   */
  jobKey: string;
  payload?: Record<string, unknown>;
  /** Lower runs first. Replies and unsubscribes outrank new outreach, always. */
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
}

export const PRIORITY = {
  /** Anything a prospect did. Always ahead of anything we want to do. */
  inbound: 10,
  human: 20,
  outbound: 100,
  background: 200,
} as const;

/**
 * Enqueue, idempotently.
 *
 * Returns the job id either way. `onConflictDoNothing` plus a follow-up select
 * rather than an upsert: re-enqueueing must not reset the attempt counter or
 * pull a job's schedule forward, or a retry loop could keep an exhausted job
 * alive forever.
 */
export async function enqueue(tx: Tx, input: EnqueueInput): Promise<string> {
  const inserted = await tx
    .insert(schema.jobs)
    .values({
      orgId: input.orgId,
      queue: input.queue,
      name: input.name,
      jobKey: input.jobKey,
      payload: input.payload ?? {},
      priority: input.priority ?? PRIORITY.outbound,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: [schema.jobs.orgId, schema.jobs.jobKey] })
    .returning({ id: schema.jobs.id });

  if (inserted[0]) return inserted[0].id;

  const [existing] = await tx
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.jobKey, input.jobKey))
    .limit(1);

  return existing!.id;
}

export type ClaimedJob = typeof schema.jobs.$inferSelect;

/**
 * Lease jobs for a worker.
 *
 * Calls `app.claim_jobs`, a SECURITY DEFINER function, because a worker has to
 * pull work across every tenant while connecting as the same NOBYPASSRLS role as
 * the web app. Confining that to one fixed statement — one table, returning only
 * queue bookkeeping — is a far smaller hole than a superuser connection or an
 * RLS exemption on `jobs`. The worker then does the actual work inside
 * `withOrg(job.orgId)`, back under RLS.
 */
export async function claim(
  tx: Tx,
  queue: Queue,
  worker: string,
  limit: number,
  leaseSeconds = 300,
): Promise<ClaimedJob[]> {
  const rows = await tx.execute(
    sql`SELECT * FROM app.claim_jobs(${queue}, ${worker}, ${limit}, ${leaseSeconds})`,
  );
  return (rows as unknown as Record<string, unknown>[]).map(fromRow);
}

/** Extend a lease on a job that is legitimately still running. */
export async function heartbeat(tx: Tx, jobId: string, leaseSeconds = 300): Promise<void> {
  await tx
    .update(schema.jobs)
    .set({
      leaseUntil: new Date(Date.now() + leaseSeconds * 1000),
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
}

export async function complete(
  tx: Tx,
  jobId: string,
  result?: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(schema.jobs)
    .set({
      status: "completed",
      result: result ?? null,
      lastError: null,
      leaseUntil: null,
      lockedBy: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
}

/**
 * Record a failure and decide whether to retry.
 *
 * A job that is out of attempts becomes `dead` rather than `failed`, and dead
 * jobs are never retried automatically. Silent infinite retry against a provider
 * that is rejecting us is how an account gets suspended.
 */
export async function fail(
  tx: Tx,
  job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">,
  error: string,
  options: { retryable: boolean; rand?: () => number } = { retryable: true },
): Promise<{ status: "queued" | "dead"; retryInSeconds: number | null }> {
  const exhausted = job.attempts >= job.maxAttempts;
  const dead = exhausted || !options.retryable;

  if (dead) {
    await tx
      .update(schema.jobs)
      .set({
        status: "dead",
        // Truncated: a provider that returns an HTML error page would otherwise
        // put a whole document in a column the UI renders inline.
        lastError: error.slice(0, 2000),
        leaseUntil: null,
        lockedBy: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, job.id));
    return { status: "dead", retryInSeconds: null };
  }

  const delay = backoffSeconds(job.attempts, {}, options.rand);
  await tx
    .update(schema.jobs)
    .set({
      status: "queued",
      lastError: error.slice(0, 2000),
      runAt: new Date(Date.now() + delay * 1000),
      leaseUntil: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));

  return { status: "queued", retryInSeconds: delay };
}

/** Operator action: put a dead job back in the queue for one more attempt. */
export async function retryDead(tx: Tx, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const rows = await tx
    .update(schema.jobs)
    .set({
      status: "queued",
      runAt: new Date(),
      // Give it headroom rather than resetting `attempts`, so the history of how
      // many times this job has already failed is not erased.
      maxAttempts: sql`${schema.jobs.attempts} + 1`,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(schema.jobs.id, jobIds), eq(schema.jobs.status, "dead")))
    .returning({ id: schema.jobs.id });
  return rows.length;
}

export async function cancel(tx: Tx, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const rows = await tx
    .update(schema.jobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(schema.jobs.id, jobIds), inArray(schema.jobs.status, ["queued", "running"])))
    .returning({ id: schema.jobs.id });
  return rows.length;
}

/**
 * postgres.js returns snake_case columns from a raw function call, and Drizzle's
 * name mapping does not apply to `tx.execute`. Mapped explicitly rather than by
 * a generic camelizer so a renamed column is a type error, not a silent
 * `undefined` on a lease timestamp.
 */
function fromRow(row: Record<string, unknown>): ClaimedJob {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    queue: row.queue as string,
    name: row.name as string,
    jobKey: row.job_key as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as ClaimedJob["status"],
    priority: Number(row.priority),
    runAt: row.run_at as Date,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lockedAt: (row.locked_at ?? null) as Date | null,
    lockedBy: (row.locked_by ?? null) as string | null,
    leaseUntil: (row.lease_until ?? null) as Date | null,
    lastError: (row.last_error ?? null) as string | null,
    result: (row.result ?? null) as Record<string, unknown> | null,
    startedAt: (row.started_at ?? null) as Date | null,
    finishedAt: (row.finished_at ?? null) as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
