CREATE TABLE "capture_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"reporter_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_via" "channel" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"phone_hash" text NOT NULL UNIQUE,
	"phone_encrypted" text NOT NULL,
	"consent_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"language" text DEFAULT 'en' NOT NULL,
	"remembered_unit_code" text,
	"pending_figures" jsonb,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" bigserial PRIMARY KEY,
	"wa_message_id" text NOT NULL UNIQUE,
	"contact_id" uuid,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_contact_idx" ON "whatsapp_messages" ("contact_id","created_at");--> statement-breakpoint
ALTER TABLE "capture_links" ADD CONSTRAINT "capture_links_reporter_id_reporters_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "reporters"("id");--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_whatsapp_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id");