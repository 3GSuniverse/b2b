ALTER TABLE "whatsapp_sessions" ALTER COLUMN "daily_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "daily_limit" DROP NOT NULL;--> statement-breakpoint
-- Numbers left at the old default follow the plan's limit from now on
UPDATE "whatsapp_sessions" SET "daily_limit" = NULL WHERE "daily_limit" = 200;--> statement-breakpoint
-- Email allowance is now a day's worth per login; the month holds 30 days of it
UPDATE "tenants" SET "monthly_quota" = "seats" * 30 * CASE "plan_id" WHEN 'basic' THEN 350 WHEN 'professional' THEN 600 WHEN 'ultra' THEN 1000 END WHERE "plan" = 'PAID' AND "plan_id" IN ('basic', 'professional', 'ultra') AND "seats" IS NOT NULL;
