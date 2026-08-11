import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { prospectStatusEnum, stepTypeEnum, verificationResultEnum } from "./enums";
import { icps } from "./icp";
import { orgs } from "./tenancy";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Dedup key. Stored lowercased, apex only (no www, no scheme). */
  domain: text("domain"),
  websiteUrl: text("website_url"),
  linkedinUrl: text("linkedin_url"),
  industry: text("industry"),
  subIndustry: text("sub_industry"),
  employeeCount: integer("employee_count"),
  sizeBand: text("size_band"),
  revenueBand: text("revenue_band"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  timezone: text("timezone"),
  techStack: text("tech_stack").array().notNull().default(sql`'{}'::text[]`),
  description: text("description"),

  // Physical presence. Populated by place-based sources (OpenStreetMap) and used
  // by the call agent, which has to know it is phoning a real address.
  phone: text("phone"),
  address: text("address"),
  postalCode: text("postal_code"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),

  source: text("source"),
  /** The source's own id for this record, so a re-run updates rather than duplicates. */
  externalId: text("external_id"),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Partial unique: domain-less records are allowed, duplicates of a known domain are not.
  uniqueIndex("companies_org_domain_uniq").on(t.orgId, t.domain).where(sql`${t.domain} IS NOT NULL`),
  // Second dedup key, for sources whose records have no domain at all — a small
  // business with a Facebook page and no website is still one company, not one
  // per discovery run.
  uniqueIndex("companies_org_external_uniq").on(t.orgId, t.source, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),
  index("companies_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
]);

export const prospects = pgTable("prospects", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),

  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name"),
  title: text("title"),
  seniority: text("seniority"),
  department: text("department"),

  email: text("email"),
  /**
   * Gate, not decoration. Only `valid` may enter a sequence; anything else
   * routes the prospect to `needs_review`. Unverified sending is the single
   * biggest driver of domain reputation damage.
   */
  emailVerification: verificationResultEnum("email_verification").notNull().default("unknown"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /**
   * Which provider supplied this address. A hard bounce has to be attributable:
   * the source that produced a bouncing address is the thing to stop trusting,
   * and without this column that is unanswerable.
   */
  emailSource: text("email_source"),
  phone: text("phone"), // E.164
  phoneType: text("phone_type"), // direct | mobile | switchboard
  linkedinUrl: text("linkedin_url"),

  /** Drives every timing guardrail. Without it the prospect cannot be scheduled. */
  timezone: text("timezone"),
  country: text("country"),
  city: text("city"),

  status: prospectStatusEnum("status").notNull().default("discovered"),
  statusReason: text("status_reason"),

  /** Set when this prospect came from a "talk to my colleague" reply. */
  referredByProspectId: uuid("referred_by_prospect_id"),

  // Orchestrator bookkeeping
  currentStepPosition: integer("current_step_position"),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  nextActionType: stepTypeEnum("next_action_type"),
  /** A human replied. Nothing automated may target this prospect again until cleared. */
  pausedByHumanReply: boolean("paused_by_human_reply").notNull().default(false),
  emailsSentCount: integer("emails_sent_count").notNull().default(0),
  callsPlacedCount: integer("calls_placed_count").notNull().default(0),
  voicemailsLeftCount: integer("voicemails_left_count").notNull().default(0),
  opensCount: integer("opens_count").notNull().default(0),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  /**
   * Denormalized from `emails` and `calls`. The guardrail engine asks "was this
   * prospect emailed today?" and "how long since the last call?" before every
   * single outbound action; two indexed aggregate queries per prospect per tick
   * is the wrong shape for the hot path.
   */
  lastEmailAt: timestamp("last_email_at", { withTimezone: true }),
  lastCallAt: timestamp("last_call_at", { withTimezone: true }),

  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  researchedAt: timestamp("researched_at", { withTimezone: true }),

  source: text("source"),
  sourceUrl: text("source_url"),
  discoveryRunId: uuid("discovery_run_id"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("prospects_org_email_uniq").on(t.orgId, t.email).where(sql`${t.email} IS NOT NULL`),
  uniqueIndex("prospects_org_linkedin_uniq").on(t.orgId, t.linkedinUrl).where(sql`${t.linkedinUrl} IS NOT NULL`),
  index("prospects_org_status_idx").on(t.orgId, t.status),
  index("prospects_org_campaign_status_idx").on(t.orgId, t.campaignId, t.status),
  index("prospects_org_company_idx").on(t.orgId, t.companyId),
  // The orchestrator's "what is due" scan. Partial, so it stays small.
  index("prospects_due_idx").on(t.orgId, t.nextActionAt).where(sql`${t.nextActionAt} IS NOT NULL`),
  index("prospects_name_trgm").using("gin", sql`${t.fullName} gin_trgm_ops`),
]);

/**
 * The anti-hallucination mechanism.
 *
 * Nothing is spoken or written to a prospect unless it exists as a row here with
 * a `sourceUrl` and a confidence at or above the org threshold. `sourceUrl` is
 * NOT NULL by design: a fact without a source is not a fact, and the schema is
 * the right place to enforce that rather than a prompt.
 */
export const prospectSignals = pgTable("prospect_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  category: text("category"),
  value: text("value").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceName: text("source_name"),
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  /** Agent id, or `call:<call_id>` when a fact came out of a conversation. */
  discoveredBy: text("discovered_by"),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("prospect_signals_confidence_range", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  check("prospect_signals_subject", sql`${t.prospectId} IS NOT NULL OR ${t.companyId} IS NOT NULL`),
  index("prospect_signals_prospect_idx").on(t.orgId, t.prospectId, t.confidence),
  index("prospect_signals_company_idx").on(t.orgId, t.companyId),
  index("prospect_signals_type_idx").on(t.orgId, t.type),
]);

/** One criterion of a fit score, as shown (and disputable) in the UI. */
export interface ScoreCriterion {
  criterion: string;
  weight: number;
  matched: boolean;
  evidenceSignalId?: string;
  note?: string;
}

export const prospectScores = pgTable("prospect_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  icpId: uuid("icp_id").notNull().references(() => icps.id, { onDelete: "cascade" }),
  icpFitScore: integer("icp_fit_score").notNull(),
  intentScore: integer("intent_score").notNull().default(0),
  reachabilityScore: integer("reachability_score").notNull().default(0),
  /** Per-criterion breakdown the user can see and dispute. */
  breakdown: jsonb("breakdown").$type<ScoreCriterion[]>().notNull().default(sql`'[]'::jsonb`),
  reasoning: text("reasoning"),
  model: text("model"),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("prospect_scores_prospect_icp_uniq").on(t.prospectId, t.icpId),
  check("prospect_scores_fit_range", sql`${t.icpFitScore} BETWEEN 0 AND 100`),
  check("prospect_scores_intent_range", sql`${t.intentScore} BETWEEN 0 AND 100`),
  check("prospect_scores_reach_range", sql`${t.reachabilityScore} BETWEEN 0 AND 100`),
  index("prospect_scores_org_fit_idx").on(t.orgId, t.icpFitScore),
]);

export type Company = typeof companies.$inferSelect;
export type Prospect = typeof prospects.$inferSelect;
export type ProspectSignal = typeof prospectSignals.$inferSelect;
export type ProspectScore = typeof prospectScores.$inferSelect;
