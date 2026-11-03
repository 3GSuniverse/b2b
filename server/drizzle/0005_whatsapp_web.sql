CREATE TYPE "public"."whatsapp_session_status" AS ENUM('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'LOGGED_OUT', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "whatsapp_auth" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	CONSTRAINT "whatsapp_auth_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"status" "whatsapp_session_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"phone" text,
	"display_name" text,
	"daily_limit" integer DEFAULT 200 NOT NULL,
	"interval_seconds" integer DEFAULT 10 NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_tenantId_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_web_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ADD CONSTRAINT "whatsapp_auth_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;