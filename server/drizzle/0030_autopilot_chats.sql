ALTER TABLE "wa_chats" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "handoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "handoff_note" text;