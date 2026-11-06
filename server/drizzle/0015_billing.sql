CREATE TYPE "public"."billing_payment_status" AS ENUM('CREATED', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TABLE "billing_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"period" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "billing_payment_status" DEFAULT 'CREATED' NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "billing_payments_razorpayOrderId_unique" UNIQUE("razorpay_order_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_tenant_id_created_at_index" ON "billing_payments" USING btree ("tenant_id","created_at");