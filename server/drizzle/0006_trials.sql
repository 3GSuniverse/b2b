CREATE TYPE "public"."tenant_plan" AS ENUM('TRIAL', 'PAID');--> statement-breakpoint
CREATE TABLE "whatsapp_trial_numbers" (
	"phone" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"first_linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" "tenant_plan" DEFAULT 'TRIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_trial_numbers" ADD CONSTRAINT "whatsapp_trial_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Companies that existed before trials (Kurukshetra and early accounts) are paying customers
UPDATE "tenants" SET "plan" = 'PAID';
