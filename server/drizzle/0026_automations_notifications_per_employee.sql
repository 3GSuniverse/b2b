ALTER TABLE "automations" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Existing automations belong to the agency owner, who can hand them out afterwards
UPDATE "automations" a SET "created_by_id" = coalesce(
  (SELECT u.id FROM "users" u WHERE u.tenant_id = a.tenant_id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1),
  (SELECT u.id FROM "users" u WHERE u.tenant_id = a.tenant_id ORDER BY u.created_at LIMIT 1)
);
