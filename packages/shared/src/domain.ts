import { z } from "zod";

/**
 * Domain enums and shared value schemas.
 *
 * These mirror the Postgres enums in docs/SCHEMA.sql exactly. When one changes,
 * both change — the migration and this file are a pair. Everything crossing an
 * API, queue, or provider boundary is parsed through a schema from here.
 */

export const ORG_ROLES = ["owner", "operator", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Capability model. Checked server-side on every mutating route. */
export const ROLE_CAPABILITIES = {
  owner: ["read", "write", "manage_credentials", "manage_members", "activate_campaign", "send"],
  operator: ["read", "write", "activate_campaign", "send"],
  viewer: ["read"],
} as const satisfies Record<OrgRole, readonly string[]>;

export type Capability = (typeof ROLE_CAPABILITIES)[OrgRole][number];

export function can(role: OrgRole, capability: Capability): boolean {
  return (ROLE_CAPABILITIES[role] as readonly string[]).includes(capability);
}

export const CREDENTIAL_STATUSES = ["unverified", "active", "failing", "revoked"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const STEP_TYPES = ["email", "call", "wait", "manual_task", "branch"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const PROSPECT_STATUSES = [
  "discovered",
  "enriching",
  "enriched",
  "needs_review",
  "qualified",
  "queued",
  "contacted",
  "engaged",
  "meeting_booked",
  "won",
  "disqualified",
  "unsubscribed",
  "bounced",
  "do_not_contact",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** No further automation may target a prospect in one of these states. */
export const TERMINAL_PROSPECT_STATUSES: readonly ProspectStatus[] = [
  "won",
  "disqualified",
  "unsubscribed",
  "bounced",
  "do_not_contact",
];

export function isTerminal(status: ProspectStatus): boolean {
  return TERMINAL_PROSPECT_STATUSES.includes(status);
}

export const ACTIVITY_TYPES = [
  "email_sent",
  "email_opened",
  "email_replied",
  "email_bounced",
  "call_placed",
  "call_connected",
  "call_completed",
  "call_voicemail",
  "note",
  "status_change",
  "task",
  "guardrail_block",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const EMAIL_STATES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

export const REPLY_INTENTS = [
  "interested",
  "question",
  "objection",
  "referral",
  "not_now",
  "not_interested",
  "unsubscribe",
  "auto_reply",
  "bounce",
  "unknown",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/** A reply of one of these intents suppresses the prospect permanently, org-wide. */
export const SUPPRESSING_INTENTS: readonly ReplyIntent[] = ["unsubscribe", "not_interested"];

/** A reply of one of these intents is a human talking. All automation pauses. */
export const HUMAN_REPLY_INTENTS: readonly ReplyIntent[] = [
  "interested",
  "question",
  "objection",
  "referral",
  "not_now",
  "not_interested",
  "unsubscribe",
];

export const CALL_DISPOSITIONS = [
  "answered",
  "no_answer",
  "voicemail",
  "gatekeeper",
  "wrong_number",
  "failed",
  "declined_permission",
] as const;
export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export const SUPPRESSION_KINDS = ["email", "domain", "phone"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const MAILBOX_STATUSES = ["connecting", "warming", "healthy", "paused", "failed"] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

export const VERIFICATION_RESULTS = ["valid", "invalid", "catch_all", "risky", "unknown"] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const JOB_STATUSES = ["queued", "running", "completed", "failed", "dead", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_STATUSES = ["planning", "running", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Queue names. One per job family, so a slow provider in one family cannot
 * starve another — the worker leases per queue with its own concurrency.
 */
export const QUEUES = [
  "discovery",
  "enrich",
  "research",
  "compose",
  "send",
  "voice",
  "reply",
  "orchestrate",
] as const;
export type Queue = (typeof QUEUES)[number];

/**
 * Only a `valid` address may enter a sequence. Everything else routes to the
 * needs-review bucket. This is the single biggest driver of domain reputation
 * damage, so it is expressed once, here, and never re-derived at a call site.
 */
export function isSendableVerification(result: VerificationResult): boolean {
  return result === "valid";
}

// ---------------------------------------------------------------------------
// Shared value schemas
// ---------------------------------------------------------------------------

/**
 * Normalize a company domain to the apex, lowercased form stored in
 * `companies.domain` — no scheme, no `www.`, no path, query string or port.
 * This is the dedup key every lead source and CSV import writes through: two
 * rows differing only by "https://" or a trailing slash have to resolve to
 * the same company, or every source recreates the ones before it.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = (s.split(/[/?#]/)[0] ?? s).trim();
  s = s.replace(/^www\./, "");
  s = s.replace(/:\d+$/, "");
  return s || null;
}

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email();
export const e164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164, e.g. +923001234567");
export const urlSchema = z.string().trim().url();
export const confidenceSchema = z.number().min(0).max(1);
export const scoreSchema = z.number().int().min(0).max(100);

/**
 * A researched fact. The message composer may only cite one of these, and only
 * when `confidence >= the org's threshold`. `sourceUrl` is required — a signal
 * without a source is not a signal, it is a guess, and guesses do not reach
 * prospects.
 */
export const signalSchema = z.object({
  type: z.string().min(1),
  category: z.string().optional(),
  value: z.string().min(1),
  sourceUrl: urlSchema,
  sourceName: z.string().optional(),
  confidence: confidenceSchema,
});
export type Signal = z.infer<typeof signalSchema>;

/** Result of every provider `testConnection()`. Rendered directly on the Connections page. */
export const testResultSchema = z.object({
  ok: z.boolean(),
  /** What the user sees. On failure: what happened and how to fix it. */
  message: z.string(),
  /** Non-secret detail worth showing — account name, verified domain, model list. */
  detail: z.record(z.unknown()).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;
