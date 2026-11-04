CREATE TYPE "public"."followup_kind" AS ENUM('PRE_TRIP', 'REVIEW', 'WHERE_NEXT');--> statement-breakpoint
CREATE TABLE "trip_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"kind" "followup_kind" NOT NULL,
	"channel" "channel",
	"message_id" text,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trip_message_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_followups" ADD CONSTRAINT "trip_followups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_followups" ADD CONSTRAINT "trip_followups_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_followups" ADD CONSTRAINT "trip_followups_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_followups_trip_id_kind_index" ON "trip_followups" USING btree ("trip_id","kind");--> statement-breakpoint
-- Payment reminders sent before this change were service messages
UPDATE "messages" SET "service" = true WHERE "trip_id" IS NOT NULL AND "campaign_id" IS NULL AND "automation_id" IS NULL;
