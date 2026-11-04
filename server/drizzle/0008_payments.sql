CREATE TYPE "public"."reminder_kind" AS ENUM('BEFORE', 'OVERDUE');--> statement-breakpoint
CREATE TABLE "trip_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"due_id" text NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"channel" "channel",
	"message_id" text,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "public_token" text;--> statement-breakpoint
-- Trips created before this change get a random token (64 hex characters) before the column becomes required
UPDATE "trips" SET "public_token" = md5(random()::text || clock_timestamp()::text || id) || md5(random()::text || id) WHERE "public_token" IS NULL;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "public_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_reminders" ADD CONSTRAINT "trip_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reminders" ADD CONSTRAINT "trip_reminders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reminders" ADD CONSTRAINT "trip_reminders_due_id_trip_dues_id_fk" FOREIGN KEY ("due_id") REFERENCES "public"."trip_dues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reminders" ADD CONSTRAINT "trip_reminders_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reminders_due_id_kind_index" ON "trip_reminders" USING btree ("due_id","kind");--> statement-breakpoint
CREATE INDEX "trip_reminders_trip_id_index" ON "trip_reminders" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_publicToken_unique" UNIQUE("public_token");