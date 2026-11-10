-- Each login links its own WhatsApp number. The agency's existing number moves to the owner's login.
ALTER TABLE "whatsapp_sessions" DROP CONSTRAINT "whatsapp_sessions_tenantId_unique";--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "whatsapp_sessions" s SET "user_id" = coalesce(
  (SELECT u.id FROM "users" u WHERE u.tenant_id = s.tenant_id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1),
  (SELECT u.id FROM "users" u WHERE u.tenant_id = s.tenant_id ORDER BY u.created_at LIMIT 1)
);--> statement-breakpoint
DELETE FROM "whatsapp_sessions" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_userId_unique" UNIQUE("user_id");--> statement-breakpoint
CREATE INDEX "whatsapp_sessions_tenant_id_index" ON "whatsapp_sessions" USING btree ("tenant_id");--> statement-breakpoint

-- Login keys belong to a session, not the agency
ALTER TABLE "whatsapp_auth" DROP CONSTRAINT "whatsapp_auth_tenant_id_key_pk";--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ADD COLUMN "session_id" text;--> statement-breakpoint
UPDATE "whatsapp_auth" a SET "session_id" = (SELECT s.id FROM "whatsapp_sessions" s WHERE s.tenant_id = a.tenant_id LIMIT 1);--> statement-breakpoint
DELETE FROM "whatsapp_auth" WHERE "session_id" IS NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ADD CONSTRAINT "whatsapp_auth_session_id_key_pk" PRIMARY KEY("session_id","key");--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ADD CONSTRAINT "whatsapp_auth_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Which number sent each WhatsApp message (for each number's own daily limit and pace)
ALTER TABLE "messages" ADD COLUMN "whatsapp_session_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "messages" m SET "whatsapp_session_id" = (SELECT s.id FROM "whatsapp_sessions" s WHERE s.tenant_id = m.tenant_id LIMIT 1)
  WHERE m.channel = 'WHATSAPP' AND m.sent_at IS NOT NULL AND m.sent_at > now() - interval '2 days';--> statement-breakpoint
CREATE INDEX "messages_whatsapp_session_id_sent_at_index" ON "messages" USING btree ("whatsapp_session_id","sent_at");--> statement-breakpoint

-- Inbox conversations happen on one employee's number
DROP INDEX "wa_chats_tenant_id_phone_index";--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "session_id" text;--> statement-breakpoint
UPDATE "wa_chats" c SET "session_id" = (SELECT s.id FROM "whatsapp_sessions" s WHERE s.tenant_id = c.tenant_id LIMIT 1);--> statement-breakpoint
DELETE FROM "wa_chats" WHERE "session_id" IS NULL;--> statement-breakpoint
ALTER TABLE "wa_chats" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD CONSTRAINT "wa_chats_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_chats_session_id_phone_index" ON "wa_chats" USING btree ("session_id","phone");
