import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { campaignStatusEnum, mailboxStatusEnum, stepTypeEnum } from "./enums";
import { icps } from "./icp";
import { credentials, orgs, users } from "./tenancy";

export const sequences = pgTable("sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  type: stepTypeEnum("type").notNull(),
  delayHours: integer("delay_hours").notNull().default(0),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /**
   * Guidance for the composer or call agent — an angle to take, not a template
   * to fill. There is deliberately no body field: every message is written fresh
   * from that prospect's signals.
   */
  instruction: text("instruction"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sequence_steps_position_uniq").on(t.sequenceId, t.position),
  index("sequence_steps_org_seq_idx").on(t.orgId, t.sequenceId),
]);

/**
 * A sending identity, with its own reputation.
 *
 * Health lives here rather than on the campaign because reputation is a property
 * of the mailbox: pausing a mailbox must stop every campaign using it, and a
 * campaign spanning three mailboxes has three independent caps.
 */
export const mailboxes = pgTable("mailboxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  displayName: text("display_name"),
  sendCredentialId: uuid("send_credential_id").references(() => credentials.id, { onDelete: "set null" }),
  recvCredentialId: uuid("recv_credential_id").references(() => credentials.id, { onDelete: "set null" }),
  status: mailboxStatusEnum("status").notNull().default("connecting"),

  // Domain auth. A campaign cannot activate until all three pass.
  spfPass: boolean("spf_pass"),
  dkimPass: boolean("dkim_pass"),
  dmarcPass: boolean("dmarc_pass"),
  domainCheckedAt: timestamp("domain_checked_at", { withTimezone: true }),

  // Warmup and health
  warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }),
  currentDailyCap: integer("current_daily_cap").notNull().default(10),
  sentToday: integer("sent_today").notNull().default(0),
  sentTodayDate: date("sent_today_date"),
  bounceRatePct: numeric("bounce_rate_pct", { precision: 5, scale: 3 }).notNull().default("0"),
  complaintRatePct: numeric("complaint_rate_pct", { precision: 5, scale: 3 }).notNull().default("0"),
  pausedReason: text("paused_reason"),
  lastSendAt: timestamp("last_send_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("mailboxes_org_email_uniq").on(t.orgId, t.email)]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  icpId: uuid("icp_id").notNull().references(() => icps.id, { onDelete: "restrict" }),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "restrict" }),

  /** Overrides on top of org settings. Null/absent keys inherit. */
  policyOverrides: jsonb("policy_overrides").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

  /** Opt-in per campaign AND gated on orgs.approvedDraftCount >= 25. */
  autoSendEnabled: boolean("auto_send_enabled").notNull().default(false),
  /** The §5 exception: calling before any email has been sent. */
  callFirst: boolean("call_first").notNull().default(false),

  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("campaigns_org_name_uniq").on(t.orgId, t.name),
  index("campaigns_org_status_idx").on(t.orgId, t.status),
]);

export const campaignMailboxes = pgTable("campaign_mailboxes", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  mailboxId: uuid("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.campaignId, t.mailboxId] })]);

export type Sequence = typeof sequences.$inferSelect;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
