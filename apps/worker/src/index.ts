import { db } from "@outreach/db";
import { claim, complete, fail } from "@outreach/jobs";
import type { ClaimedJob } from "@outreach/jobs";
import { isRetryable } from "@outreach/shared";
import type { Queue } from "@outreach/shared";
import { runDiscoveryJob } from "./discovery";

/**
 * Worker process.
 *
 * Polls one queue at a time via `app.claim_jobs` (see packages/db/src/sql/97-jobs.sql
 * for why that has to be a fixed cross-tenant function rather than a per-org
 * query), runs the matching handler inside `withOrg(job.orgId)`, and reports
 * success or failure back onto the job row. Only `discovery` has a handler
 * today — enrich/research/compose/send/voice/reply/orchestrate are queued
 * (see the job payloads on Sending Health/Jobs pages) but nothing drains them
 * yet; that is the next phase of work, not a bug in this file.
 */

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 3000;
const BATCH_SIZE = 3;
const LEASE_SECONDS = 300;

const HANDLERS: Partial<Record<Queue, Record<string, (job: ClaimedJob) => Promise<Record<string, unknown> | void>>>> = {
  discovery: { "discovery.run": runDiscoveryJob },
};

let shuttingDown = false;
process.on("SIGINT", () => (shuttingDown = true));
process.on("SIGTERM", () => (shuttingDown = true));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue(queue: Queue, handlers: Record<string, (job: ClaimedJob) => Promise<Record<string, unknown> | void>>): Promise<void> {
  const jobs = await db().transaction((tx) => claim(tx, queue, WORKER_ID, BATCH_SIZE, LEASE_SECONDS));

  for (const job of jobs) {
    const handler = handlers[job.name];
    if (!handler) {
      await db().transaction((tx) => fail(tx, job, `No handler for job "${job.name}" on queue "${queue}".`, { retryable: false }));
      continue;
    }

    console.log(`[${WORKER_ID}] ${job.name} (${job.id}) org=${job.orgId} starting`);
    try {
      const result = await handler(job);
      await db().transaction((tx) => complete(tx, job.id, result ?? undefined));
      console.log(`[${WORKER_ID}] ${job.name} (${job.id}) completed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await db().transaction((tx) => fail(tx, job, message, { retryable: isRetryable(err) }));
      console.error(`[${WORKER_ID}] ${job.name} (${job.id}) failed: ${message} -> ${outcome.status}`);
    }
  }
}

async function tick(): Promise<void> {
  for (const [queue, handlers] of Object.entries(HANDLERS) as [Queue, Record<string, (job: ClaimedJob) => Promise<Record<string, unknown> | void>>][]) {
    await processQueue(queue, handlers);
  }
}

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] starting — polling every ${POLL_INTERVAL_MS}ms — queues: ${Object.keys(HANDLERS).join(", ")}`);
  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      console.error(`[${WORKER_ID}] tick failed:`, err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(`[${WORKER_ID}] shutting down`);
  process.exit(0);
}

main();
