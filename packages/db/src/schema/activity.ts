import { sql } from "drizzle-orm";
import {
  boolean,
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
import { campaigns, mailboxes, sequenceSteps } from "./campaigns";
import {
  activityTypeEnum,
  callDispositionEnum,
  emailDirectionEnum,
  emailStateEnum,
  replyIntentEnum,
} from "./enums";
import { proofAssets } from "./icp";
import { prospects } from "./prospects";
import { orgs, users } from "./tenancy";

/**
 * The unified timeline. Every channel writes here, so the prospect profile
 * renders one chronological story rather than two systems' logs side by side.
 */
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  type: activityTypeEnum("type").notNull(),
  /** Polymorphic pointer; `type` says which table. */
  subjectTable: text("subject_table"),
  subjectId: uuid("subject_id"),
  /** 'system' | 'agent:<id>' | 'user:<uuid>' */
  actor: text("actor"),
  summary: text("summary"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("activities_timeline_idx").on(t.orgId, t.prospectId, t.occurredAt),
  index("activities_campaign_idx").on(t.orgId, t.campaignId, t.occurredAt),
  index("activities_type_idx").on(t.orgId, t.type, t.occurredAt),
]);

/** Per-rule outcome from the content validator, stored so the user can see why a draft was rejected. */
export interface ValidatorReport {
  passed: boolean;
  violations: { rule: string; detail: string }[];
  wordCount?: number;
  spamScore?: number;
}

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  sequenceStepId: uuid("sequence_step_id").references(() => sequenceSteps.id, { onDelete: "set null" }),
  mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),

  direction: emailDirectionEnum("direction").notNull().default("outbound"),
  state: emailStateEnum("state").notNull().default("draft"),

  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  bodyHtml: text("body_html"),

  threadId: text("thread_id"),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),

  /**
   * Traceability. `reasoning` is the composer's own account of why it wrote what
   * it wrote; `citedSignalIds` are the facts it was allowed to use. Together they
   * let a user answer "where did this claim come from" without guessing.
   */
  reasoning: text("reasoning"),
  citedSignalIds: uuid("cited_signal_ids").array().notNull().default(sql`'{}'::uuid[]`),
  proofAssetId: uuid("proof_asset_id").references(() => proofAssets.id, { onDelete: "set null" }),
  model: text("model"),
  generationCostUsd: numeric("generation_cost_usd", { precision: 14, scale: 6 }),
  validatorReport: jsonb("validator_report").$type<ValidatorReport>(),
  regenerationCount: integer("regeneration_count").notNull().default(0),

  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  bounceType: text("bounce_type"),
  opensCount: integer("opens_count").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("emails_prospect_idx").on(t.orgId, t.prospectId, t.createdAt),
  // Drives the approval queue. Partial, so it stays small as sent volume grows.
  index("emails_pending_idx").on(t.orgId, t.state)
    .where(sql`${t.state} IN ('pending_approval','queued')`),
  index("emails_thread_idx").on(t.orgId, t.threadId),
  uniqueIndex("emails_provider_msg_uniq").on(t.orgId, t.provider, t.providerMessageId)
    .where(sql`${t.providerMessageId} IS NOT NULL`),
]);

export const emailReplies = pgTable("email_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
  threadId: text("thread_id"),
  messageId: text("message_id"),
  fromEmail: text("from_email").notNull(),
  rawBody: text("raw_body").notNull(),
  /** Quoted history stripped. What the classifier and the human both read. */
  parsedBody: text("parsed_body"),
  intent: replyIntentEnum("intent").notNull().default("unknown"),
  sentiment: numeric("sentiment", { precision: 3, scale: 2 }),
  classificationReasoning: text("classification_reasoning"),
  model: text("model"),
  /** Parsed out of an out-of-office auto-reply so the sequence can resume after it. */
  oooReturnDate: date("ooo_return_date"),
  referredName: text("referred_name"),
  referredEmail: text("referred_email"),
  createdProspectId: uuid("created_prospect_id").references(() => prospects.id, { onDelete: "set null" }),
  handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("email_replies_prospect_idx").on(t.orgId, t.prospectId, t.receivedAt),
  // The Inbox: replies still waiting on a human.
  index("email_replies_unhandled_idx").on(t.orgId, t.intent).where(sql`${t.handledAt} IS NULL`),
]);

/** One turn of a call, as stored in `calls.transcript`. */
export interface TranscriptTurn {
  role: "assistant" | "user" | "system";
  text: string;
  startedAt?: string;
  endedAt?: string;
}

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  sequenceStepId: uuid("sequence_step_id").references(() => sequenceSteps.id, { onDelete: "set null" }),

  provider: text("provider").notNull().default("vapi"),
  vapiCallId: text("vapi_call_id"),
  phoneNumberId: text("phone_number_id"),
  /** The per-prospect assistant overrides actually sent, kept for auditability. */
  assistantConfig: jsonb("assistant_config").$type<Record<string, unknown>>(),

  status: text("status"), // queued | ringing | in_progress | ended
  endedReason: text("ended_reason"),
  disposition: callDispositionEnum("disposition"),
  durationSeconds: integer("duration_seconds"),
  recordingUrl: text("recording_url"),

  /** Turn-by-turn, not the flattened string the legacy MVP stored. */
  transcript: jsonb("transcript").$type<TranscriptTurn[]>(),
  transcriptText: text("transcript_text"),
  summary: text("summary"),
  sentiment: numeric("sentiment", { precision: 3, scale: 2 }),
  objections: jsonb("objections").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  commitments: jsonb("commitments").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  nextStep: text("next_step"),
  /** Did the prospect agree to continue after the permission ask? */
  permissionGranted: boolean("permission_granted"),
  voicemailLeft: boolean("voicemail_left").notNull().default(false),
  callbackRequestedAt: timestamp("callback_requested_at", { withTimezone: true }),

  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),

  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("calls_vapi_uniq").on(t.orgId, t.vapiCallId).where(sql`${t.vapiCallId} IS NOT NULL`),
  index("calls_prospect_idx").on(t.orgId, t.prospectId, t.createdAt),
  index("calls_campaign_idx").on(t.orgId, t.campaignId, t.createdAt),
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  provider: text("provider").notNull().default("calcom"),
  providerBookingId: text("provider_booking_id"),
  startTime: timestamp("start_time", { withTimezone: true }),
  attendeeName: text("attendee_name"),
  attendeeEmail: text("attendee_email"),
  status: text("status").notNull().default("confirmed"),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bookings_org_start_idx").on(t.orgId, t.startTime)]);

export type Activity = typeof activities.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type EmailReply = typeof emailReplies.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
