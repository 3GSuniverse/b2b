CREATE TYPE "public"."quote_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."rate_kind" AS ENUM('HOTEL', 'TRANSPORT', 'ACTIVITY', 'TRAVEL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."rate_unit" AS ENUM('PER_NIGHT', 'PER_DAY', 'PER_PERSON', 'PER_GROUP');--> statement-breakpoint
ALTER TYPE "public"."followup_kind" ADD VALUE 'QUOTE_FOLLOWUP';--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "quote_status" DEFAULT 'DRAFT' NOT NULL,
	"intro" text,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms" text,
	"discount" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"valid_until" date,
	"public_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_publicToken_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "rate_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "rate_kind" NOT NULL,
	"name" text NOT NULL,
	"destination" text,
	"unit" "rate_unit" NOT NULL,
	"price" integer NOT NULL,
	"cost" integer,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_items" ADD CONSTRAINT "rate_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_trip_id_version_index" ON "quotes" USING btree ("trip_id","version");--> statement-breakpoint
CREATE INDEX "quotes_tenant_id_status_index" ON "quotes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rate_items_tenant_id_destination_index" ON "rate_items" USING btree ("tenant_id","destination");