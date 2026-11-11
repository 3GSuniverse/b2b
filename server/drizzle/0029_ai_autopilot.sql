ALTER TABLE "tenants" ADD COLUMN "ai_language" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "ai_draft" text;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD COLUMN "ai_draft_note" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;