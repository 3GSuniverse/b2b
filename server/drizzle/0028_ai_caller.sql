CREATE TABLE "call_optouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"phone" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"agent_name" text DEFAULT 'Asha' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"purpose" text DEFAULT 'BOTH' NOT NULL,
	"greeting" text,
	"instructions" text,
	"call_from" text,
	"hours_from" text DEFAULT '09:00' NOT NULL,
	"hours_to" text DEFAULT '20:00' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_settings_callFrom_unique" UNIQUE("call_from")
);
--> statement-breakpoint
CREATE TABLE "call_violations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_wallet_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"call_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"direction" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"purpose" text DEFAULT 'BOTH' NOT NULL,
	"outcome" text,
	"summary" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script" text,
	"provider_call_id" text,
	"seconds" integer DEFAULT 0 NOT NULL,
	"minutes_billed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_optouts" ADD CONSTRAINT "call_optouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_violations" ADD CONSTRAINT "call_violations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_violations" ADD CONSTRAINT "call_violations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_wallet_entries" ADD CONSTRAINT "call_wallet_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_wallet_entries" ADD CONSTRAINT "call_wallet_entries_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_optouts_tenant_id_phone_index" ON "call_optouts" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "call_violations_tenant_id_created_at_index" ON "call_violations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "call_wallet_entries_tenant_id_index" ON "call_wallet_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calls_tenant_id_created_at_index" ON "calls" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_tenant_id_phone_index" ON "calls" USING btree ("tenant_id","phone");