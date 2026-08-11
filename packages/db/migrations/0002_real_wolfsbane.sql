CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"weight" integer DEFAULT 50 NOT NULL,
	"notes" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text,
	"credential_id" uuid,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_org_name_uniq" ON "data_sources" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "data_sources_org_kind_idx" ON "data_sources" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "data_sources_provider_idx" ON "data_sources" USING btree ("org_id","provider");