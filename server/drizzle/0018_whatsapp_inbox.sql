CREATE TABLE "wa_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"direction" text NOT NULL,
	"source" text NOT NULL,
	"body" text,
	"media_kind" text,
	"media_name" text,
	"wa_id" text,
	"message_id" text,
	"sent_by_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"phone" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_preview" text,
	"last_direction" text,
	"unread" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_chat_messages" ADD CONSTRAINT "wa_chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_chat_messages" ADD CONSTRAINT "wa_chat_messages_chat_id_wa_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."wa_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_chat_messages" ADD CONSTRAINT "wa_chat_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_chat_messages" ADD CONSTRAINT "wa_chat_messages_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_chats" ADD CONSTRAINT "wa_chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_chat_messages_tenant_id_wa_id_index" ON "wa_chat_messages" USING btree ("tenant_id","wa_id");--> statement-breakpoint
CREATE INDEX "wa_chat_messages_chat_id_at_index" ON "wa_chat_messages" USING btree ("chat_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_chats_tenant_id_phone_index" ON "wa_chats" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "wa_chats_tenant_id_last_message_at_index" ON "wa_chats" USING btree ("tenant_id","last_message_at");