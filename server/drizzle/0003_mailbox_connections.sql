CREATE TYPE "public"."connection_status" AS ENUM('ACTIVE', 'REVOKED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('GOOGLE', 'MICROSOFT');--> statement-breakpoint
CREATE TYPE "public"."sender_kind" AS ENUM('DOMAIN', 'GMAIL', 'OUTLOOK');--> statement-breakpoint
CREATE TABLE "mailbox_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" text NOT NULL,
	"daily_limit" integer DEFAULT 400 NOT NULL,
	"status" "connection_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_error" text,
	"connected_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "senders" ALTER COLUMN "domain_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_id" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "kind" "sender_kind" DEFAULT 'DOMAIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_connections_tenant_id_provider_email_index" ON "mailbox_connections" USING btree ("tenant_id","provider","email");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sender_id_sent_at_index" ON "messages" USING btree ("sender_id","sent_at");--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "sender_target" CHECK (("senders"."kind" = 'DOMAIN' and "senders"."domain_id" is not null) or ("senders"."kind" <> 'DOMAIN' and "senders"."connection_id" is not null));