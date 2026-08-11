import { pgEnum } from "drizzle-orm/pg-core";
import {
  ACTIVITY_TYPES,
  CALL_DISPOSITIONS,
  CAMPAIGN_STATUSES,
  CREDENTIAL_STATUSES,
  EMAIL_STATES,
  JOB_STATUSES,
  MAILBOX_STATUSES,
  ORG_ROLES,
  PROSPECT_STATUSES,
  REPLY_INTENTS,
  RUN_STATUSES,
  STEP_TYPES,
  SUPPRESSION_KINDS,
  VERIFICATION_RESULTS,
} from "@outreach/shared";

/**
 * Postgres enums, derived from the single source of truth in
 * `@outreach/shared/domain`. Adding a value there and regenerating the
 * migration is the only way to add one — the two can never drift.
 */

export const orgRoleEnum = pgEnum("org_role", ORG_ROLES);
export const credentialStatusEnum = pgEnum("credential_status", CREDENTIAL_STATUSES);
export const campaignStatusEnum = pgEnum("campaign_status", CAMPAIGN_STATUSES);
export const stepTypeEnum = pgEnum("step_type", STEP_TYPES);
export const prospectStatusEnum = pgEnum("prospect_status", PROSPECT_STATUSES);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);
export const emailDirectionEnum = pgEnum("email_direction", ["outbound", "inbound"]);
export const emailStateEnum = pgEnum("email_state", EMAIL_STATES);
export const replyIntentEnum = pgEnum("reply_intent", REPLY_INTENTS);
export const callDispositionEnum = pgEnum("call_disposition", CALL_DISPOSITIONS);
export const suppressionScopeEnum = pgEnum("suppression_scope", ["org", "global"]);
export const suppressionKindEnum = pgEnum("suppression_kind", SUPPRESSION_KINDS);
export const mailboxStatusEnum = pgEnum("mailbox_status", MAILBOX_STATUSES);
export const verificationResultEnum = pgEnum("verification_result", VERIFICATION_RESULTS);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
