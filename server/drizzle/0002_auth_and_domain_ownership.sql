CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP INDEX "sending_domains_tenant_id_domain_index";--> statement-breakpoint
DROP INDEX "users_tenant_id_email_index";--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "ownership_token" text;--> statement-breakpoint
UPDATE "sending_domains" SET "ownership_token" = 'sandesh-verify=' || md5(random()::text || id) WHERE "ownership_token" IS NULL;--> statement-breakpoint
ALTER TABLE "sending_domains" ALTER COLUMN "ownership_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "ownership_status" "verification_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_index" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_domain_index" ON "sending_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "sending_domains_tenant_id_index" ON "sending_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_index" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_id_index" ON "users" USING btree ("tenant_id");