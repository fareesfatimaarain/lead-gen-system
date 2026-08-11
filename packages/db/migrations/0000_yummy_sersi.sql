CREATE TYPE "public"."activity_type" AS ENUM('email_sent', 'email_opened', 'email_replied', 'email_bounced', 'call_placed', 'call_connected', 'call_completed', 'call_voicemail', 'note', 'status_change', 'task', 'guardrail_block');--> statement-breakpoint
CREATE TYPE "public"."call_disposition" AS ENUM('answered', 'no_answer', 'voicemail', 'gatekeeper', 'wrong_number', 'failed', 'declined_permission');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('unverified', 'active', 'failing', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."email_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."email_state" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('connecting', 'warming', 'healthy', 'paused', 'failed');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('discovered', 'enriching', 'enriched', 'needs_review', 'qualified', 'queued', 'contacted', 'engaged', 'meeting_booked', 'won', 'disqualified', 'unsubscribed', 'bounced', 'do_not_contact');--> statement-breakpoint
CREATE TYPE "public"."reply_intent" AS ENUM('interested', 'question', 'objection', 'referral', 'not_now', 'not_interested', 'unsubscribe', 'auto_reply', 'bounce', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('email', 'call', 'wait', 'manual_task', 'branch');--> statement-breakpoint
CREATE TYPE "public"."suppression_kind" AS ENUM('email', 'domain', 'phone');--> statement-breakpoint
CREATE TYPE "public"."suppression_scope" AS ENUM('org', 'global');--> statement-breakpoint
CREATE TYPE "public"."verification_result" AS ENUM('valid', 'invalid', 'catch_all', 'risky', 'unknown');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"encrypted_value" "bytea" NOT NULL,
	"encryption_iv" "bytea" NOT NULL,
	"encryption_tag" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"masked_hint" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "credential_status" DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"approved_draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active_org_id" uuid,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"mailbox_daily_cap" integer DEFAULT 40 NOT NULL,
	"warmup_weeks" integer DEFAULT 4 NOT NULL,
	"send_interval_min_seconds" integer DEFAULT 240 NOT NULL,
	"send_interval_max_seconds" integer DEFAULT 1800 NOT NULL,
	"bounce_rate_pause_pct" numeric(5, 3) DEFAULT '3.000' NOT NULL,
	"complaint_rate_pause_pct" numeric(5, 3) DEFAULT '0.100' NOT NULL,
	"max_emails_per_prospect" integer DEFAULT 4 NOT NULL,
	"max_calls_per_prospect" integer DEFAULT 2 NOT NULL,
	"cross_campaign_cooldown_days" integer DEFAULT 90 NOT NULL,
	"one_contact_per_company" boolean DEFAULT true NOT NULL,
	"call_window_start_hour" smallint DEFAULT 9 NOT NULL,
	"call_window_end_hour" smallint DEFAULT 18 NOT NULL,
	"min_days_between_calls" integer DEFAULT 4 NOT NULL,
	"max_voicemails" integer DEFAULT 2 NOT NULL,
	"send_on_weekends" boolean DEFAULT false NOT NULL,
	"respect_public_holidays" boolean DEFAULT true NOT NULL,
	"banned_phrases" text[] DEFAULT ARRAY[
    'quick question','circling back','just bumping','bumping this to the top',
    'hope this finds you well','I was so impressed','Love what you''re doing at',
    'reaching out','touch base','synergy','game changer'
  ]::text[] NOT NULL,
	"max_first_touch_words" integer DEFAULT 120 NOT NULL,
	"min_signal_confidence" numeric(3, 2) DEFAULT '0.70' NOT NULL,
	"spam_score_threshold" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"open_tracking_enabled" boolean DEFAULT false NOT NULL,
	"min_icp_fit_score" integer DEFAULT 60 NOT NULL,
	"approval_mode_default" boolean DEFAULT true NOT NULL,
	"monthly_spend_cap_usd" numeric(12, 2),
	"spend_hard_cutoff" boolean DEFAULT true NOT NULL,
	"call_recording_disclosure" text,
	"jurisdiction" text,
	"default_country_code" text DEFAULT '1' NOT NULL,
	"agent_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text,
	"auth_provider" text,
	"auth_subject" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"sub_industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"company_size_bands" text[] DEFAULT '{}'::text[] NOT NULL,
	"revenue_bands" text[] DEFAULT '{}'::text[] NOT NULL,
	"geographies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tech_stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"business_models" text[] DEFAULT '{}'::text[] NOT NULL,
	"titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"seniority_levels" text[] DEFAULT '{}'::text[] NOT NULL,
	"departments" text[] DEFAULT '{}'::text[] NOT NULL,
	"decision_role" text,
	"exclusion_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"qualifying_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"excluded_industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"competitor_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"pain_hypothesis" text,
	"value_proposition" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"icp_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metric_value" text,
	"source_url" text,
	"segment_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_mailboxes" (
	"campaign_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	CONSTRAINT "campaign_mailboxes_campaign_id_mailbox_id_pk" PRIMARY KEY("campaign_id","mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"icp_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"policy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_send_enabled" boolean DEFAULT false NOT NULL,
	"call_first" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"send_credential_id" uuid,
	"recv_credential_id" uuid,
	"status" "mailbox_status" DEFAULT 'connecting' NOT NULL,
	"spf_pass" boolean,
	"dkim_pass" boolean,
	"dmarc_pass" boolean,
	"domain_checked_at" timestamp with time zone,
	"warmup_started_at" timestamp with time zone,
	"current_daily_cap" integer DEFAULT 10 NOT NULL,
	"sent_today" integer DEFAULT 0 NOT NULL,
	"sent_today_date" date,
	"bounce_rate_pct" numeric(5, 3) DEFAULT '0' NOT NULL,
	"complaint_rate_pct" numeric(5, 3) DEFAULT '0' NOT NULL,
	"paused_reason" text,
	"last_send_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "step_type" NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instruction" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website_url" text,
	"linkedin_url" text,
	"industry" text,
	"sub_industry" text,
	"employee_count" integer,
	"size_band" text,
	"revenue_band" text,
	"country" text,
	"region" text,
	"city" text,
	"timezone" text,
	"tech_stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"icp_id" uuid NOT NULL,
	"icp_fit_score" integer NOT NULL,
	"intent_score" integer DEFAULT 0 NOT NULL,
	"reachability_score" integer DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text,
	"model" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_scores_fit_range" CHECK ("prospect_scores"."icp_fit_score" BETWEEN 0 AND 100),
	CONSTRAINT "prospect_scores_intent_range" CHECK ("prospect_scores"."intent_score" BETWEEN 0 AND 100),
	CONSTRAINT "prospect_scores_reach_range" CHECK ("prospect_scores"."reachability_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "prospect_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid,
	"company_id" uuid,
	"type" text NOT NULL,
	"category" text,
	"value" text NOT NULL,
	"source_url" text NOT NULL,
	"source_name" text,
	"confidence" numeric(3, 2) NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discovered_by" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_signals_confidence_range" CHECK ("prospect_signals"."confidence" >= 0 AND "prospect_signals"."confidence" <= 1),
	CONSTRAINT "prospect_signals_subject" CHECK ("prospect_signals"."prospect_id" IS NOT NULL OR "prospect_signals"."company_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"campaign_id" uuid,
	"first_name" text,
	"last_name" text,
	"full_name" text,
	"title" text,
	"seniority" text,
	"department" text,
	"email" text,
	"email_verification" "verification_result" DEFAULT 'unknown' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"phone_type" text,
	"linkedin_url" text,
	"timezone" text,
	"country" text,
	"city" text,
	"status" "prospect_status" DEFAULT 'discovered' NOT NULL,
	"status_reason" text,
	"referred_by_prospect_id" uuid,
	"current_step_position" integer,
	"next_action_at" timestamp with time zone,
	"next_action_type" "step_type",
	"paused_by_human_reply" boolean DEFAULT false NOT NULL,
	"emails_sent_count" integer DEFAULT 0 NOT NULL,
	"calls_placed_count" integer DEFAULT 0 NOT NULL,
	"voicemails_left_count" integer DEFAULT 0 NOT NULL,
	"opens_count" integer DEFAULT 0 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"source" text,
	"source_url" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid,
	"type" "activity_type" NOT NULL,
	"subject_table" text,
	"subject_id" uuid,
	"actor" text,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid,
	"campaign_id" uuid,
	"call_id" uuid,
	"provider" text DEFAULT 'calcom' NOT NULL,
	"provider_booking_id" text,
	"start_time" timestamp with time zone,
	"attendee_name" text,
	"attendee_email" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid,
	"sequence_step_id" uuid,
	"provider" text DEFAULT 'vapi' NOT NULL,
	"vapi_call_id" text,
	"phone_number_id" text,
	"assistant_config" jsonb,
	"status" text,
	"ended_reason" text,
	"disposition" "call_disposition",
	"duration_seconds" integer,
	"recording_url" text,
	"transcript" jsonb,
	"transcript_text" text,
	"summary" text,
	"sentiment" numeric(3, 2),
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_step" text,
	"permission_granted" boolean,
	"voicemail_left" boolean DEFAULT false NOT NULL,
	"callback_requested_at" timestamp with time zone,
	"cost_usd" numeric(14, 6),
	"raw_payload" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"email_id" uuid,
	"thread_id" text,
	"message_id" text,
	"from_email" text NOT NULL,
	"raw_body" text NOT NULL,
	"parsed_body" text,
	"intent" "reply_intent" DEFAULT 'unknown' NOT NULL,
	"sentiment" numeric(3, 2),
	"classification_reasoning" text,
	"model" text,
	"ooo_return_date" date,
	"referred_name" text,
	"referred_email" text,
	"created_prospect_id" uuid,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid,
	"sequence_step_id" uuid,
	"mailbox_id" uuid,
	"direction" "email_direction" DEFAULT 'outbound' NOT NULL,
	"state" "email_state" DEFAULT 'draft' NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"thread_id" text,
	"message_id" text,
	"in_reply_to" text,
	"provider" text,
	"provider_message_id" text,
	"reasoning" text,
	"cited_signal_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"proof_asset_id" uuid,
	"model" text,
	"generation_cost_usd" numeric(14, 6),
	"validator_report" jsonb,
	"regeneration_count" integer DEFAULT 0 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"bounce_type" text,
	"opens_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"prospect_id" uuid,
	"campaign_id" uuid,
	"model" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"schema_valid" boolean,
	"repair_attempted" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(14, 6),
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrail_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid,
	"campaign_id" uuid,
	"mailbox_id" uuid,
	"channel" text NOT NULL,
	"rule" text NOT NULL,
	"reason" text NOT NULL,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"job_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"period" date DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"icp_id" uuid,
	"source" text NOT NULL,
	"query" text,
	"leads_returned" integer DEFAULT 0 NOT NULL,
	"leads_new" integer DEFAULT 0 NOT NULL,
	"leads_qualified" integer DEFAULT 0 NOT NULL,
	"avg_fit_score" numeric(5, 2),
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"error" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"scope" "suppression_scope" DEFAULT 'org' NOT NULL,
	"kind" "suppression_kind" NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"source_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_scope_org" CHECK (("suppressions"."scope" = 'global' AND "suppressions"."org_id" IS NULL) OR ("suppressions"."scope" = 'org' AND "suppressions"."org_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_org_id_orgs_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_assets" ADD CONSTRAINT "proof_assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_assets" ADD CONSTRAINT "proof_assets_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_send_credential_id_credentials_id_fk" FOREIGN KEY ("send_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_recv_credential_id_credentials_id_fk" FOREIGN KEY ("recv_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_scores" ADD CONSTRAINT "prospect_scores_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_scores" ADD CONSTRAINT "prospect_scores_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_scores" ADD CONSTRAINT "prospect_scores_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signals" ADD CONSTRAINT "prospect_signals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signals" ADD CONSTRAINT "prospect_signals_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signals" ADD CONSTRAINT "prospect_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_sequence_step_id_sequence_steps_id_fk" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_created_prospect_id_prospects_id_fk" FOREIGN KEY ("created_prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_sequence_step_id_sequence_steps_id_fk" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_proof_asset_id_proof_assets_id_fk" FOREIGN KEY ("proof_asset_id") REFERENCES "public"."proof_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_events" ADD CONSTRAINT "guardrail_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_events" ADD CONSTRAINT "guardrail_events_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_events" ADD CONSTRAINT "guardrail_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_events" ADD CONSTRAINT "guardrail_events_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs_log" ADD CONSTRAINT "jobs_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_performance" ADD CONSTRAINT "source_performance_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_performance" ADD CONSTRAINT "source_performance_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_org_provider_label_uniq" ON "credentials" USING btree ("org_id","provider","label");--> statement-breakpoint
CREATE INDEX "credentials_org_provider_idx" ON "credentials" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_subject_uniq" ON "users" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "icps_org_name_uniq" ON "icps" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "proof_assets_org_icp_idx" ON "proof_assets" USING btree ("org_id","icp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_name_uniq" ON "campaigns" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_org_email_uniq" ON "mailboxes" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_position_uniq" ON "sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE INDEX "sequence_steps_org_seq_idx" ON "sequence_steps" USING btree ("org_id","sequence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_domain_uniq" ON "companies" USING btree ("org_id","domain") WHERE "companies"."domain" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_name_trgm" ON "companies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_scores_prospect_icp_uniq" ON "prospect_scores" USING btree ("prospect_id","icp_id");--> statement-breakpoint
CREATE INDEX "prospect_scores_org_fit_idx" ON "prospect_scores" USING btree ("org_id","icp_fit_score");--> statement-breakpoint
CREATE INDEX "prospect_signals_prospect_idx" ON "prospect_signals" USING btree ("org_id","prospect_id","confidence");--> statement-breakpoint
CREATE INDEX "prospect_signals_company_idx" ON "prospect_signals" USING btree ("org_id","company_id");--> statement-breakpoint
CREATE INDEX "prospect_signals_type_idx" ON "prospect_signals" USING btree ("org_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_org_email_uniq" ON "prospects" USING btree ("org_id","email") WHERE "prospects"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_org_linkedin_uniq" ON "prospects" USING btree ("org_id","linkedin_url") WHERE "prospects"."linkedin_url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prospects_org_status_idx" ON "prospects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "prospects_org_campaign_status_idx" ON "prospects" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "prospects_org_company_idx" ON "prospects" USING btree ("org_id","company_id");--> statement-breakpoint
CREATE INDEX "prospects_due_idx" ON "prospects" USING btree ("org_id","next_action_at") WHERE "prospects"."next_action_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prospects_name_trgm" ON "prospects" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "activities_timeline_idx" ON "activities" USING btree ("org_id","prospect_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_campaign_idx" ON "activities" USING btree ("org_id","campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_type_idx" ON "activities" USING btree ("org_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "bookings_org_start_idx" ON "bookings" USING btree ("org_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_vapi_uniq" ON "calls" USING btree ("org_id","vapi_call_id") WHERE "calls"."vapi_call_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "calls_prospect_idx" ON "calls" USING btree ("org_id","prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_campaign_idx" ON "calls" USING btree ("org_id","campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "email_replies_prospect_idx" ON "email_replies" USING btree ("org_id","prospect_id","received_at");--> statement-breakpoint
CREATE INDEX "email_replies_unhandled_idx" ON "email_replies" USING btree ("org_id","intent") WHERE "email_replies"."handled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "emails_prospect_idx" ON "emails" USING btree ("org_id","prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "emails_pending_idx" ON "emails" USING btree ("org_id","state") WHERE "emails"."state" IN ('pending_approval','queued');--> statement-breakpoint
CREATE INDEX "emails_thread_idx" ON "emails" USING btree ("org_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_provider_msg_uniq" ON "emails" USING btree ("org_id","provider","provider_message_id") WHERE "emails"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_runs_org_idx" ON "agent_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("org_id","agent","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_prospect_idx" ON "agent_runs" USING btree ("org_id","prospect_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("org_id","action","created_at");--> statement-breakpoint
CREATE INDEX "guardrail_events_org_idx" ON "guardrail_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "guardrail_events_rule_idx" ON "guardrail_events" USING btree ("org_id","rule","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_log_job_attempt_uniq" ON "jobs_log" USING btree ("queue","job_id","attempt");--> statement-breakpoint
CREATE INDEX "jobs_log_queue_idx" ON "jobs_log" USING btree ("org_id","queue","created_at");--> statement-breakpoint
CREATE INDEX "jobs_log_failed_idx" ON "jobs_log" USING btree ("org_id","status") WHERE "jobs_log"."status" IN ('failed','dead');--> statement-breakpoint
CREATE INDEX "provider_usage_period_idx" ON "provider_usage" USING btree ("org_id","period","provider");--> statement-breakpoint
CREATE INDEX "source_performance_lookup_idx" ON "source_performance" USING btree ("org_id","icp_id","source","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_uniq" ON "suppressions" USING btree ("org_id","kind","value") WHERE "suppressions"."org_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_global_uniq" ON "suppressions" USING btree ("kind","value") WHERE "suppressions"."org_id" IS NULL;--> statement-breakpoint
CREATE INDEX "suppressions_lookup_idx" ON "suppressions" USING btree ("kind","value");