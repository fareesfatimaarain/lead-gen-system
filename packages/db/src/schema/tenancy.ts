import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { credentialStatusEnum, orgRoleEnum } from "./enums";

/** Raw bytes. Used only by the credential vault — ciphertext, IV, auth tag. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * Auto-send unlock gate. A campaign may only enable auto-send once this
   * reaches 25 — the user has to have read and approved 25 real drafts before
   * the system is allowed to send unsupervised. Server-side counter; there is
   * no UI toggle that bypasses it.
   */
  approvedDraftCount: integer("approved_draft_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored lowercased by the application. */
  email: text("email").notNull().unique(),
  name: text("name"),
  /**
   * scrypt hash, format `scrypt$N$r$p$saltB64$hashB64`. Null for a user who has
   * only ever signed in through an external identity provider.
   */
  passwordHash: text("password_hash"),
  authProvider: text("auth_provider"),
  authSubject: text("auth_subject"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_auth_subject_uniq").on(t.authProvider, t.authSubject)]);

export const orgMembers = pgTable("org_members", {
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRoleEnum("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId] }),
  index("org_members_user_idx").on(t.userId),
]);

/**
 * Server-side sessions. The cookie carries an opaque id only; nothing about the
 * user's identity or org is client-readable or client-settable. `activeOrgId`
 * lives here rather than in the cookie for the same reason — it is the value
 * every RLS policy resolves through, so it must not be forgeable.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeOrgId: uuid("active_org_id").references(() => orgs.id, { onDelete: "set null" }),
  /** SHA-256 of the cookie token. A database leak does not yield usable sessions. */
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)]);

/**
 * Fixed-window counters for pre-authentication endpoints.
 *
 * In Postgres rather than in process memory because the limit has to hold across
 * however many instances are running — an in-memory counter multiplies the real
 * limit by the replica count, which is the same as not having one. Redis would
 * also work, but nothing else here needs Redis and an optional dependency that
 * silently disables a security control is worse than a table.
 *
 * The key is already an opaque hash when it derives from an email address, so
 * this table cannot be read to enumerate who has an account.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rate_limits_window_idx").on(t.windowStart)]);

/**
 * The credential vault.
 *
 * AES-256-GCM. Ciphertext, IV and auth tag are stored in separate columns so a
 * partial read can never be mistaken for a decryptable value. The master key is
 * the one secret that stays in the server environment; everything tenant-scoped
 * lives here. Plaintext never crosses the API boundary — the client only ever
 * receives `maskedHint`.
 */
export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** Registry key: 'vapi', 'anthropic', 'resend', 'smtp', ... */
  provider: text("provider").notNull(),
  label: text("label").notNull(),

  encryptedValue: bytea("encrypted_value").notNull(),
  encryptionIv: bytea("encryption_iv").notNull(),
  encryptionTag: bytea("encryption_tag").notNull(),
  keyVersion: smallint("key_version").notNull().default(1),

  /** Non-secret display fragment, e.g. `sk-…4f2a`. Safe to return to the client. */
  maskedHint: text("masked_hint").notNull(),
  /** Non-secret provider config: region, from-domain, host, port, account id. */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

  status: credentialStatusEnum("status").notNull().default("unverified"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastError: text("last_error"),

  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("credentials_org_provider_label_uniq").on(t.orgId, t.provider, t.label),
  index("credentials_org_provider_idx").on(t.orgId, t.provider),
]);

/**
 * Per-org sending policy and guardrail thresholds.
 *
 * Defaults here are the conservative ones from the brief. They are deliberately
 * low: a new org should be slow and safe, and raising a cap should be a decision
 * the user makes knowingly rather than a default they inherit.
 */
export const settings = pgTable("settings", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),

  // Volume and reputation
  mailboxDailyCap: integer("mailbox_daily_cap").notNull().default(40),
  warmupWeeks: integer("warmup_weeks").notNull().default(4),
  sendIntervalMinSeconds: integer("send_interval_min_seconds").notNull().default(240),
  sendIntervalMaxSeconds: integer("send_interval_max_seconds").notNull().default(1800),
  bounceRatePausePct: numeric("bounce_rate_pause_pct", { precision: 5, scale: 3 }).notNull().default("3.000"),
  complaintRatePausePct: numeric("complaint_rate_pause_pct", { precision: 5, scale: 3 }).notNull().default("0.100"),

  // Frequency and consent
  maxEmailsPerProspect: integer("max_emails_per_prospect").notNull().default(4),
  maxCallsPerProspect: integer("max_calls_per_prospect").notNull().default(2),
  crossCampaignCooldownDays: integer("cross_campaign_cooldown_days").notNull().default(90),
  oneContactPerCompany: boolean("one_contact_per_company").notNull().default(true),
  callWindowStartHour: smallint("call_window_start_hour").notNull().default(9),
  callWindowEndHour: smallint("call_window_end_hour").notNull().default(18),
  minDaysBetweenCalls: integer("min_days_between_calls").notNull().default(4),
  maxVoicemails: integer("max_voicemails").notNull().default(2),
  sendOnWeekends: boolean("send_on_weekends").notNull().default(false),
  respectPublicHolidays: boolean("respect_public_holidays").notNull().default(true),

  // Content
  bannedPhrases: text("banned_phrases").array().notNull().default(sql`ARRAY[
    'quick question','circling back','just bumping','bumping this to the top',
    'hope this finds you well','I was so impressed','Love what you''re doing at',
    'reaching out','touch base','synergy','game changer'
  ]::text[]`),
  maxFirstTouchWords: integer("max_first_touch_words").notNull().default(120),
  minSignalConfidence: numeric("min_signal_confidence", { precision: 3, scale: 2 }).notNull().default("0.70"),
  spamScoreThreshold: numeric("spam_score_threshold", { precision: 5, scale: 2 }).notNull().default("5.00"),
  /** Off by default. Explained in Settings, not silently enabled. */
  openTrackingEnabled: boolean("open_tracking_enabled").notNull().default(false),

  // Qualification
  minIcpFitScore: integer("min_icp_fit_score").notNull().default(60),

  // Approval — on by default for every new org
  approvalModeDefault: boolean("approval_mode_default").notNull().default(true),

  // Spend
  monthlySpendCapUsd: numeric("monthly_spend_cap_usd", { precision: 12, scale: 2 }),
  spendHardCutoff: boolean("spend_hard_cutoff").notNull().default(true),

  /**
   * What one booked consultation is worth. Drives the Acquisition screen, which
   * is the only place this product answers "is this working" in the currency the
   * customer thinks in.
   *
   * Deliberately nullable with no default: a made-up patient value produces a
   * confident, wrong ROI, and a clinic quoting 18-month lifetime value and one
   * quoting first-treatment revenue are answering different questions. The
   * screen asks for it rather than assuming.
   */
  patientValueUsd: numeric("patient_value_usd", { precision: 12, scale: 2 }),

  // Compliance
  callRecordingDisclosure: text("call_recording_disclosure"),
  jurisdiction: text("jurisdiction"),
  defaultCountryCode: text("default_country_code").notNull().default("1"),

  /** Per-agent model selection, e.g. `{"message_composer":"claude-opus-5"}`. */
  agentModels: jsonb("agent_models").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Settings = typeof settings.$inferSelect;
