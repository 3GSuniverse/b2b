ALTER TABLE "sessions" ADD COLUMN "care_staff_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "care_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "support_access" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_care_staff_id_care_staff_id_fk" FOREIGN KEY ("care_staff_id") REFERENCES "public"."care_staff"("id") ON DELETE cascade ON UPDATE no action;