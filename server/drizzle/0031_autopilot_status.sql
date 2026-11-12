ALTER TABLE "wa_chats" ADD COLUMN "autopilot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "ai_status" text;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "ai_status_note" text;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "ai_status_at" timestamp with time zone;