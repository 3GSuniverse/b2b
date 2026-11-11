DROP INDEX "contacts_tenant_id_email_index";--> statement-breakpoint
DROP INDEX "contacts_tenant_id_phone_index";--> statement-breakpoint
DROP INDEX "lists_tenant_id_name_index";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_id_owner_id_email_index" ON "contacts" USING btree ("tenant_id","owner_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_id_owner_id_phone_index" ON "contacts" USING btree ("tenant_id","owner_id","phone");--> statement-breakpoint
CREATE INDEX "contacts_owner_id_index" ON "contacts" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_tenant_id_owner_id_name_index" ON "lists" USING btree ("tenant_id","owner_id","name");--> statement-breakpoint
-- Existing customers and lists go to the agency owner, who can hand them out afterwards
UPDATE "contacts" c SET "owner_id" = coalesce(
  (SELECT u.id FROM "users" u WHERE u.tenant_id = c.tenant_id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1),
  (SELECT u.id FROM "users" u WHERE u.tenant_id = c.tenant_id ORDER BY u.created_at LIMIT 1)
);--> statement-breakpoint
UPDATE "lists" l SET "owner_id" = coalesce(
  (SELECT u.id FROM "users" u WHERE u.tenant_id = l.tenant_id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1),
  (SELECT u.id FROM "users" u WHERE u.tenant_id = l.tenant_id ORDER BY u.created_at LIMIT 1)
);
