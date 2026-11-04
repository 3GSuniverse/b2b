CREATE TYPE "public"."payment_method" AS ENUM('UPI', 'CASH', 'BANK', 'CARD', 'ONLINE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."trip_kind" AS ENUM('PRIVATE', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('ENQUIRY', 'QUOTED', 'BOOKED', 'COMPLETED', 'LOST', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "trip_dues" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"receipt_number" integer NOT NULL,
	"amount" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"note" text,
	"paid_at" timestamp with time zone NOT NULL,
	"provider_payment_id" text,
	"public_token" text NOT NULL,
	"recorded_by_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_payments_providerPaymentId_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "trip_payments_publicToken_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"kind" "trip_kind" DEFAULT 'PRIVATE' NOT NULL,
	"status" "trip_status" DEFAULT 'ENQUIRY' NOT NULL,
	"contact_id" text,
	"customer_name" text NOT NULL,
	"title" text NOT NULL,
	"destination" text,
	"start_date" date,
	"end_date" date,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"budget" integer,
	"price" integer DEFAULT 0 NOT NULL,
	"source" text,
	"notes" text,
	"lost_reason" text,
	"assigned_to_id" text,
	"created_by_id" text,
	"status_changed_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_dues" ADD CONSTRAINT "trip_dues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_dues" ADD CONSTRAINT "trip_dues_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_dues_trip_id_index" ON "trip_dues" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_dues_tenant_id_due_date_index" ON "trip_dues" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_payments_tenant_id_receipt_number_index" ON "trip_payments" USING btree ("tenant_id","receipt_number");--> statement-breakpoint
CREATE INDEX "trip_payments_trip_id_index" ON "trip_payments" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_payments_tenant_id_paid_at_index" ON "trip_payments" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_tenant_id_number_index" ON "trips" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "trips_tenant_id_status_index" ON "trips" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "trips_contact_id_index" ON "trips" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "trips_tenant_id_start_date_index" ON "trips" USING btree ("tenant_id","start_date");