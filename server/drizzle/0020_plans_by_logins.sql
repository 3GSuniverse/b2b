ALTER TABLE "billing_payments" ADD COLUMN "seats" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "seats" integer;--> statement-breakpoint
-- Plans by size (Team 5/10/20/50) become Professional with the same number of logins
UPDATE "billing_payments" SET "seats" = CASE "plan_id" WHEN 'team5' THEN 5 WHEN 'team10' THEN 10 WHEN 'team20' THEN 20 WHEN 'team50' THEN 50 ELSE "seats" END, "plan_id" = 'professional' WHERE "plan_id" LIKE 'team%';--> statement-breakpoint
UPDATE "billing_payments" SET "applied_at" = "paid_at" WHERE "status" = 'PAID' AND "applied_at" IS NULL;--> statement-breakpoint
UPDATE "billing_payments" SET "kind" = 'CHANGE' WHERE "kind" = 'UPGRADE';--> statement-breakpoint
UPDATE "tenants" SET "seats" = CASE "plan_id" WHEN 'team5' THEN 5 WHEN 'team10' THEN 10 WHEN 'team20' THEN 20 WHEN 'team50' THEN 50 END, "plan_id" = 'professional' WHERE "plan_id" LIKE 'team%';
