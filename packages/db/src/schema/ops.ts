import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { campaigns, mailboxes } from "./campaigns";
import { suppressionKindEnum, suppressionScopeEnum } from "./enums";
import { icps } from "./icp";
import { prospects } from "./prospects";
import { credentials, orgs, users } from "./tenancy";

/**
 * Suppressions. `orgId IS NULL` means global — visible to every org, writable
 * only by the service role. Checked before every send and every dial, on the
 * hot path, which is why `suppressions_lookup_idx` exists on (kind, value)
 * independent of tenancy.
 */
export const suppressions = pgTable("suppressions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
  scope: suppressionScopeEnum("scope").notNull().default("org"),
  kind: suppressionKindEnum("kind").notNull(),
  /** Email, apex domain, or E.164 phone. Stored lowercased. */
  value: text("value").notNull(),
  reason: text("reason").notNull(),
  /** 'reply:unsubscribe' | 'call:not_interested' | 'dnc_import' | 'manual' | 'bounce' */
  source: text("source"),
  sourceId: uuid("source_id"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("suppressions_scope_org", sql`(${t.scope} = 'global' AND ${t.orgId} IS NULL) OR (${t.scope} = 'org' AND ${t.orgId} IS NOT NULL)`),
  uniqueIndex("suppressions_org_uniq").on(t.orgId, t.kind, t.value).where(sql`${t.orgId} IS NOT NULL`),
  uniqueIndex("suppressions_global_uniq").on(t.kind, t.value).where(sql`${t.orgId} IS NULL`),
  index("suppressions_lookup_idx").on(t.kind, t.value),
]);

/**
 * Feedback the Source Strategist reads to re-rank sources on the next run.
 * Without this the strategist would run the same playbook every time regardless
 * of what actually worked for this ICP.
 */
export const sourcePerformance = pgTable("source_performance", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  icpId: uuid("icp_id").references(() => icps.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  query: text("query"),
  leadsReturned: integer("leads_returned").notNull().default(0),
  leadsNew: integer("leads_new").notNull().default(0),
  leadsQualified: integer("leads_qualified").notNull().default(0),
  avgFitScore: numeric("avg_fit_score", { precision: 5, scale: 2 }),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("source_performance_lookup_idx").on(t.orgId, t.icpId, t.source, t.ranAt)]);

/**
 * Shareable source registry for discovery, enrichment and verification.
 *
 * `provider` ties an instance to an entry in the adapter registry
 * (`packages/adapters/src/registry.ts`) — the code that actually knows how to
 * call OpenStreetMap, Hunter, Apollo, and so on. It is nullable so a manually
 * named source (a referral pipeline, a purchased list someone tracks here for
 * ranking purposes only) is still representable without pretending to be a
 * real adapter. `credentialId` is set only when the provider needs a key;
 * `onDelete: set null` rather than cascade, because disconnecting a
 * credential should pause the source, not silently delete the org's ranking
 * history for it.
 */
export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // lead_source | enrichment | verification | search | crm
  status: text("status").notNull().default("active"), // active | paused | disabled
  weight: integer("weight").notNull().default(50),
  notes: text("notes"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** Adapter registry id, e.g. "overpass", "hunter_domain_search". Null for a manual/custom entry. */
  provider: text("provider"),
  credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestMessage: text("last_test_message"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("data_sources_org_name_uniq").on(t.orgId, t.name),
  index("data_sources_org_kind_idx").on(t.orgId, t.kind),
  index("data_sources_provider_idx").on(t.orgId, t.provider),
]);

export const jobsLog = pgTable("jobs_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  queue: text("queue").notNull(),
  jobName: text("job_name").notNull(),
  /** BullMQ idempotency key. Same domain event -> same key -> no duplicate send. */
  jobId: text("job_id").notNull(),
  status: text("status").notNull(), // queued | active | completed | failed | dead
  attempt: integer("attempt").notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("jobs_log_job_attempt_uniq").on(t.queue, t.jobId, t.attempt),
  index("jobs_log_queue_idx").on(t.orgId, t.queue, t.createdAt),
  index("jobs_log_failed_idx").on(t.orgId, t.status).where(sql`${t.status} IN ('failed','dead')`),
]);

/** Every agent invocation. This is what the Activity Log screen renders. */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  schemaValid: boolean("schema_valid"),
  repairAttempted: boolean("repair_attempted").notNull().default(false),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_runs_org_idx").on(t.orgId, t.createdAt),
  index("agent_runs_agent_idx").on(t.orgId, t.agent, t.createdAt),
  index("agent_runs_prospect_idx").on(t.orgId, t.prospectId),
]);

export const providerUsage = pgTable("provider_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  units: integer("units").notNull().default(1),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
  period: date("period").notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("provider_usage_period_idx").on(t.orgId, t.period, t.provider)]);

/**
 * Every guardrail denial.
 *
 * A denial is never silent — this table is what makes "why is nothing sending?"
 * answerable in the Sending Health panel. If the engine blocks something and
 * writes nothing here, that is a bug.
 */
export const guardrailEvents = pgTable("guardrail_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
  channel: text("channel").notNull(), // email | call
  rule: text("rule").notNull(),
  reason: text("reason").notNull(),
  retryAfter: timestamp("retry_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("guardrail_events_org_idx").on(t.orgId, t.createdAt),
  index("guardrail_events_rule_idx").on(t.orgId, t.rule, t.createdAt),
]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** credential.read | credential.create | campaign.activate | suppression.delete | ... */
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: uuid("entity_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_log_org_idx").on(t.orgId, t.createdAt),
  index("audit_log_action_idx").on(t.orgId, t.action, t.createdAt),
]);

export type Suppression = typeof suppressions.$inferSelect;
export type DataSource = typeof dataSources.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type GuardrailEvent = typeof guardrailEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
