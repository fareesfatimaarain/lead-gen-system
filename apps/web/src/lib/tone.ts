import type {
  CallDisposition,
  CampaignStatus,
  CredentialStatus,
  EmailState,
  JobStatus,
  MailboxStatus,
  ProspectStatus,
  ReplyIntent,
  RunStatus,
  VerificationResult,
} from "@outreach/shared";
import type { Tone } from "@/components/ui";

/**
 * Status colour, in one place.
 *
 * Colour in this interface carries meaning and nothing else, which only works if
 * a given state is the same colour on every screen. Defining these per-component
 * is how "green" quietly comes to mean four different things.
 *
 * The default is deliberately `neutral`: a state nobody has thought about should
 * not arrive pre-tinted with reassurance.
 */

export const prospectTone: Record<ProspectStatus, Tone> = {
  discovered: "neutral",
  enriching: "neutral",
  enriched: "neutral",
  needs_review: "warn",
  qualified: "accent",
  queued: "accent",
  contacted: "accent",
  engaged: "ok",
  meeting_booked: "ok",
  won: "ok",
  disqualified: "neutral",
  unsubscribed: "danger",
  bounced: "danger",
  do_not_contact: "danger",
};

export const emailTone: Record<EmailState, Tone> = {
  draft: "neutral",
  pending_approval: "warn",
  approved: "accent",
  rejected: "neutral",
  queued: "accent",
  sent: "ok",
  delivered: "ok",
  bounced: "danger",
  complained: "danger",
  failed: "danger",
};

export const campaignTone: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  active: "ok",
  paused: "warn",
  completed: "neutral",
  archived: "neutral",
};

export const credentialTone: Record<CredentialStatus, Tone> = {
  unverified: "warn",
  active: "ok",
  failing: "danger",
  revoked: "neutral",
};

export const mailboxTone: Record<MailboxStatus, Tone> = {
  connecting: "neutral",
  warming: "warn",
  healthy: "ok",
  paused: "warn",
  failed: "danger",
};

export const callTone: Record<CallDisposition, Tone> = {
  answered: "ok",
  no_answer: "neutral",
  voicemail: "neutral",
  gatekeeper: "warn",
  wrong_number: "warn",
  failed: "danger",
  declined_permission: "danger",
};

export const replyTone: Record<ReplyIntent, Tone> = {
  interested: "ok",
  question: "accent",
  objection: "warn",
  referral: "accent",
  not_now: "neutral",
  not_interested: "neutral",
  unsubscribe: "danger",
  auto_reply: "neutral",
  bounce: "danger",
  unknown: "neutral",
};

export const jobTone: Record<JobStatus, Tone> = {
  queued: "neutral",
  running: "accent",
  completed: "ok",
  failed: "warn",
  dead: "danger",
  cancelled: "neutral",
};

export const runTone: Record<RunStatus, Tone> = {
  planning: "accent",
  running: "accent",
  completed: "ok",
  failed: "danger",
  cancelled: "neutral",
};

/**
 * Email verification.
 *
 * Only `valid` is green, because only `valid` may enter a sequence. Showing
 * `catch_all` as anything other than a caution would misrepresent the single
 * biggest driver of domain reputation damage.
 */
export const verificationTone: Record<VerificationResult, Tone> = {
  valid: "ok",
  invalid: "danger",
  catch_all: "warn",
  risky: "warn",
  unknown: "neutral",
};

/** ICP fit. The band boundaries match the default qualification threshold of 60. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  if (score >= 80) return "ok";
  if (score >= 60) return "accent";
  if (score >= 40) return "warn";
  return "danger";
}
