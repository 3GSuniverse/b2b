ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "kind" text DEFAULT 'NEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "gst" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_by_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "login_code" text;--> statement-breakpoint
-- Existing agencies: their unique slug becomes the agency ID (the owner can change it)
UPDATE "tenants" SET "login_code" = "slug" WHERE "login_code" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "login_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
-- Messages already sent: credit broadcasts to whoever made them
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_id_username_index" ON "users" USING btree ("tenant_id","username");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_loginCode_unique" UNIQUE("login_code");--> statement-breakpoint
UPDATE "messages" m SET "sent_by_id" = c."created_by_id" FROM "campaigns" c WHERE m."campaign_id" = c."id" AND m."sent_by_id" IS NULL;