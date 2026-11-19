CREATE TYPE "knowledge_status" AS ENUM('pending', 'approved', 'retired');--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"topic" text NOT NULL,
	"fact" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"status" "knowledge_status" DEFAULT 'pending'::"knowledge_status" NOT NULL,
	"entered_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_entered_by_admin_users_id_fkey" FOREIGN KEY ("entered_by") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_approved_by_admin_users_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("id");