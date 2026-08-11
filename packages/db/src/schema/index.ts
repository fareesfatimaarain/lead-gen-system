export * from "./enums";
export * from "./tenancy";
export * from "./icp";
export * from "./campaigns";
export * from "./prospects";
export * from "./activity";
export * from "./ops";
export * from "./jobs";

/**
 * Every org-scoped table, in the order RLS policies are applied.
 *
 * `orgs`, `users`, `org_members` and `sessions` are deliberately absent: a user
 * belongs to many orgs, so they cannot carry a single `org_id` predicate. They
 * get membership-derived policies instead (see migrations/9999_rls.sql). Every
 * other table follows the org_id rule without exception — if you add a table and
 * it is not in this list, it has no RLS and that is a security bug.
 */
export const ORG_SCOPED_TABLES = [
  "credentials",
  "settings",
  "icps",
  "proof_assets",
  "sequences",
  "sequence_steps",
  "mailboxes",
  "campaigns",
  "campaign_mailboxes",
  "companies",
  "prospects",
  "prospect_signals",
  "prospect_scores",
  "activities",
  "emails",
  "email_replies",
  "calls",
  "bookings",
  "source_performance",
  "data_sources",
  "jobs_log",
  "jobs",
  "discovery_runs",
  "enrichment_attempts",
  "agent_runs",
  "provider_usage",
  "guardrail_events",
  "audit_log",
] as const;
