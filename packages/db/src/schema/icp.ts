import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orgs, users } from "./tenancy";

/** Geography filter entry on an ICP. */
export interface IcpGeography {
  country?: string;
  region?: string;
  city?: string;
  radiusKm?: number;
}

/** A qualifying signal the Source Strategist and Scoring Agent both read. */
export interface QualifyingSignal {
  type: string; // hiring | funded | uses_competitor | expanding | poor_web_presence | ...
  label: string;
  weight: number; // 0-1, contribution to the fit score
  lookbackDays?: number;
}

/**
 * The ICP. Structured, not a blob — every field here is something the Source
 * Strategist reasons over, the Scoring Agent scores against, or the Message
 * Composer draws on. A free-text ICP would make all three guess.
 */
export const icps = pgTable("icps", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),

  // Firmographics
  industries: text("industries").array().notNull().default(sql`'{}'::text[]`),
  subIndustries: text("sub_industries").array().notNull().default(sql`'{}'::text[]`),
  companySizeBands: text("company_size_bands").array().notNull().default(sql`'{}'::text[]`),
  revenueBands: text("revenue_bands").array().notNull().default(sql`'{}'::text[]`),
  geographies: jsonb("geographies").$type<IcpGeography[]>().notNull().default(sql`'[]'::jsonb`),
  techStack: text("tech_stack").array().notNull().default(sql`'{}'::text[]`),
  businessModels: text("business_models").array().notNull().default(sql`'{}'::text[]`),

  // Persona
  titles: text("titles").array().notNull().default(sql`'{}'::text[]`),
  seniorityLevels: text("seniority_levels").array().notNull().default(sql`'{}'::text[]`),
  departments: text("departments").array().notNull().default(sql`'{}'::text[]`),
  decisionRole: text("decision_role"), // decision_maker | influencer | champion
  exclusionTitles: text("exclusion_titles").array().notNull().default(sql`'{}'::text[]`),

  qualifyingSignals: jsonb("qualifying_signals").$type<QualifyingSignal[]>().notNull().default(sql`'[]'::jsonb`),

  // Disqualifiers — hard excludes, evaluated before anything else
  excludedDomains: text("excluded_domains").array().notNull().default(sql`'{}'::text[]`),
  excludedIndustries: text("excluded_industries").array().notNull().default(sql`'{}'::text[]`),
  competitorDomains: text("competitor_domains").array().notNull().default(sql`'{}'::text[]`),

  /** What this ICP's pain is, and what the customer sells against it. Free text — read by the composer. */
  painHypothesis: text("pain_hypothesis"),
  valueProposition: text("value_proposition"),

  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("icps_org_name_uniq").on(t.orgId, t.name)]);

/** Case studies, metrics and references the composer may cite, tagged by segment. */
export const proofAssets = pgTable("proof_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** Null means "applies to every ICP in this org". */
  icpId: uuid("icp_id").references(() => icps.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // case_study | metric | reference | testimonial
  title: text("title").notNull(),
  body: text("body").notNull(),
  metricValue: text("metric_value"),
  sourceUrl: text("source_url"),
  segmentTags: text("segment_tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("proof_assets_org_icp_idx").on(t.orgId, t.icpId)]);

export type Icp = typeof icps.$inferSelect;
export type ProofAsset = typeof proofAssets.$inferSelect;
