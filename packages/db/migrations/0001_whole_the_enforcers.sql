CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('planning', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"icp_id" uuid NOT NULL,
	"campaign_id" uuid,
	"status" "run_status" DEFAULT 'planning' NOT NULL,
	"target_count" integer DEFAULT 50 NOT NULL,
	"plan" jsonb,
	"plan_reasoning" text,
	"plan_model" text,
	"companies_found" integer DEFAULT 0 NOT NULL,
	"prospects_found" integer DEFAULT 0 NOT NULL,
	"prospects_new" integer DEFAULT 0 NOT NULL,
	"duplicates_skipped" integer DEFAULT 0 NOT NULL,
	"suppressed_skipped" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrichment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prospect_id" uuid,
	"provider" text NOT NULL,
	"field" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"name" text NOT NULL,
	"job_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "email_source" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "last_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "last_call_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "researched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "discovery_run_id" uuid;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_attempts" ADD CONSTRAINT "enrichment_attempts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_attempts" ADD CONSTRAINT "enrichment_attempts_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_runs_org_idx" ON "discovery_runs" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "enrichment_attempts_prospect_idx" ON "enrichment_attempts" USING btree ("org_id","prospect_id");--> statement-breakpoint
CREATE INDEX "enrichment_attempts_provider_idx" ON "enrichment_attempts" USING btree ("org_id","provider","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_key_uniq" ON "jobs" USING btree ("org_id","job_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","priority","run_at") WHERE "jobs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_external_uniq" ON "companies" USING btree ("org_id","source","external_id") WHERE "companies"."external_id" IS NOT NULL;