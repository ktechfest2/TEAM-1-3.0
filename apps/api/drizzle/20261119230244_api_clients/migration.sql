CREATE TYPE "api_client_status" AS ENUM('pending', 'active', 'revoked', 'rejected');--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organisation" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"website" text,
	"purpose" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL UNIQUE,
	"status" "api_client_status" DEFAULT 'pending'::"api_client_status" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"last_used_at" timestamp with time zone,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_decided_by_admin_users_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "admin_users"("id");