CREATE TYPE "incident_label" AS ENUM('supported', 'partly_supported', 'not_supported', 'unconfirmed', 'under_review');--> statement-breakpoint
CREATE TYPE "incident_status" AS ENUM('pending', 'published', 'held', 'hidden');--> statement-breakpoint
CREATE TYPE "incident_type" AS ENUM('late_officials', 'bvas_problem', 'vote_buying', 'intimidation_violence', 'ballot_snatching', 'missing_ec60e', 'other');--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"reference" text NOT NULL UNIQUE,
	"polling_unit_id" integer NOT NULL,
	"reporter_id" uuid NOT NULL,
	"type" "incident_type" NOT NULL,
	"claim" text NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "incident_status" DEFAULT 'pending'::"incident_status" NOT NULL,
	"label" "incident_label" DEFAULT 'unconfirmed'::"incident_label" NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"location_accuracy" double precision,
	"evidence_key" text,
	"evidence_sha256" text NOT NULL,
	"evidence_type" text NOT NULL,
	"assessment" jsonb,
	"corroboration" integer DEFAULT 0 NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"published_at" timestamp with time zone,
	"client_id" uuid
);
--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD COLUMN "pending_report" jsonb;--> statement-breakpoint
CREATE INDEX "incident_reports_unit_idx" ON "incident_reports" ("polling_unit_id","received_at");--> statement-breakpoint
CREATE INDEX "incident_reports_status_idx" ON "incident_reports" ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_reports_client_idx" ON "incident_reports" ("reporter_id","client_id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_polling_unit_id_polling_units_id_fkey" FOREIGN KEY ("polling_unit_id") REFERENCES "polling_units"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reporter_id_reporters_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "reporters"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reviewed_by_admin_users_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id");