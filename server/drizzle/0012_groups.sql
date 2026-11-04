CREATE TABLE "trip_travellers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"age" integer,
	"gender" text,
	"phone" text,
	"id_type" text,
	"id_number_enc" text,
	"id_last4" text,
	"food" text,
	"needs" text,
	"emergency_name" text,
	"emergency_phone" text,
	"room" text,
	"seat" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "per_person_price" integer;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_travellers_trip_id_index" ON "trip_travellers" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_group_id_trips_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_group_id_index" ON "trips" USING btree ("group_id");