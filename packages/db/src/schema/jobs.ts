import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { jobStatusEnum, runStatusEnum } from "./enums";
import { icps } from "./icp";
import { prospects } from "./prospects";
import { orgs, users } from "./tenancy";

/**
 * The work queue.
 *
 * Postgres rather than Redis. `FOR UPDATE SKIP LOCKED` gives concurrent workers
 * exactly-once leasing, and putting the queue in the same database as the data
 * means enqueueing a send and writing the row that justifies it happen in one
 * transaction — a job can never exist for a row that was rolled back. It also
 * removes a whole process from the deployment, which for a system whose
 * throughput ceiling is deliberately low is the right trade.
 *
 * `jobKey` is the idempotency key, derived from the domain event
 * (`send:{campaign}:{prospect}:{step}`). Enqueueing the same key twice is a
 * no-op, which is what makes "one email per step" survive a retry, a redeploy,
 * or a duplicate webhook.
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  queue: text("queue").notNull(),
  name: text("name").notNull(),
  jobKey: text("job_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

  status: jobStatusEnum("status").notNull().default("queued"),
  /** Lower runs first. Replies and unsubscribes outrank new outreach, always. */
  priority: integer("priority").notNull().default(100),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),

  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  /** Lease expiry. A worker that dies mid-job releases its work automatically. */
  leaseUntil: timestamp("lease_until", { withTimezone: true }),

  lastError: text("last_error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("jobs_key_uniq").on(t.orgId, t.jobKey),
  // The claim scan. Partial, so it stays the size of the backlog rather than the
  // size of history — completed jobs fall out of the index entirely.
  index("jobs_claim_idx").on(t.queue, t.priority, t.runAt)
    .where(sql`${t.status} IN ('queued','running')`),
  index("jobs_org_status_idx").on(t.orgId, t.status, t.createdAt),
]);

/**
 * One discovery pass: an ICP, the plan the Source Strategist produced, and what
 * each source actually returned.
 *
 * The plan is stored rather than recomputed so that "why did it search there?"
 * has an answer months later, and so a run can be re-executed exactly.
 */
export const discoveryRuns = pgTable("discovery_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  icpId: uuid("icp_id").notNull().references(() => icps.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),

  status: runStatusEnum("status").notNull().default("planning"),
  /** Hard ceiling the user set before the run started. Never exceeded. */
  targetCount: integer("target_count").notNull().default(50),

  /** The Source Strategist's output, verbatim. */
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  planReasoning: text("plan_reasoning"),
  planModel: text("plan_model"),

  companiesFound: integer("companies_found").notNull().default(0),
  prospectsFound: integer("prospects_found").notNull().default(0),
  prospectsNew: integer("prospects_new").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  suppressedSkipped: integer("suppressed_skipped").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),

  error: text("error"),
  startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("discovery_runs_org_idx").on(t.orgId, t.startedAt)]);

/**
 * Every enrichment attempt, per provider, per field.
 *
 * This exists for one specific reason: when an address hard-bounces we have to
 * be able to say which source supplied it, and stop trusting that source. A
 * waterfall that silently overwrites its own history cannot answer that.
 */
export const enrichmentAttempts = pgTable("enrichment_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  /** email | phone | title | timezone | company_size | ... */
  field: text("field").notNull(),
  /** hit | miss | error | skipped */
  outcome: text("outcome").notNull(),
  detail: text("detail"),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("enrichment_attempts_prospect_idx").on(t.orgId, t.prospectId),
  index("enrichment_attempts_provider_idx").on(t.orgId, t.provider, t.outcome),
]);

export type Job = typeof jobs.$inferSelect;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type EnrichmentAttempt = typeof enrichmentAttempts.$inferSelect;
