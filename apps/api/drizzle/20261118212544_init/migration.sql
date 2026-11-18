CREATE TYPE "admin_role" AS ENUM('reviewer', 'declarations_admin', 'approver', 'system_admin');--> statement-breakpoint
CREATE TYPE "area_level" AS ENUM('polling_unit', 'ward', 'lga', 'state', 'national');--> statement-breakpoint
CREATE TYPE "channel" AS ENUM('web', 'whatsapp', 'sms', 'ussd');--> statement-breakpoint
CREATE TYPE "confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "declaration_source" AS ENUM('collation_result_photo', 'inec_statement', 'broadcast');--> statement-breakpoint
CREATE TYPE "declaration_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "election_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "election_type" AS ENUM('presidential', 'governorship', 'senate', 'house_of_representatives', 'state_assembly', 'area_council', 'local_government');--> statement-breakpoint
CREATE TYPE "submission_kind" AS ENUM('photo', 'typed');--> statement-breakpoint
CREATE TYPE "submission_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "unit_status" AS ENUM('not_confirmed', 'counted', 'provisional', 'disputed', 'resolved');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"display_name" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"reporter_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_via" "channel" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_entries" (
	"seq" bigserial PRIMARY KEY,
	"entry_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"election_id" uuid NOT NULL,
	"level" "area_level" NOT NULL,
	"area_code" text,
	"figures" jsonb NOT NULL,
	"unit_figures" jsonb,
	"declared_at" timestamp with time zone NOT NULL,
	"source_kind" "declaration_source" NOT NULL,
	"source_url" text,
	"source_file_key" text,
	"source_sha256" text,
	"status" "declaration_status" DEFAULT 'pending'::"declaration_status" NOT NULL,
	"entered_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "election_parties" (
	"election_id" uuid,
	"party_id" integer,
	"ballot_order" integer NOT NULL,
	CONSTRAINT "election_parties_pkey" PRIMARY KEY("election_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"type" "election_type" NOT NULL,
	"title" text NOT NULL,
	"election_date" date NOT NULL,
	"scope_level" "area_level" NOT NULL,
	"scope_code" text,
	"polls_close_at" timestamp with time zone NOT NULL,
	"status" "election_status" DEFAULT 'draft'::"election_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lgas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"state_id" integer NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"acronym" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polling_units" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "polling_units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ward_id" integer NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"registered_voters" integer
);
--> statement-breakpoint
CREATE TABLE "rejection_log" (
	"id" bigserial PRIMARY KEY,
	"reporter_id" uuid NOT NULL,
	"election_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"phone_hash" text NOT NULL UNIQUE,
	"phone_encrypted" text NOT NULL,
	"consent_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"election_id" uuid NOT NULL,
	"polling_unit_id" integer NOT NULL,
	"figures_hash" text NOT NULL,
	"figures" jsonb NOT NULL,
	"witness_count" integer DEFAULT 0 NOT NULL,
	"typed_support_count" integer DEFAULT 0 NOT NULL,
	"confidence" "confidence_level",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "states_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"election_id" uuid NOT NULL,
	"polling_unit_id" integer,
	"reporter_id" uuid NOT NULL,
	"kind" "submission_kind" NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "submission_status" DEFAULT 'pending'::"submission_status" NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"image_key" text,
	"image_sha256" text,
	"extracted" jsonb,
	"voter_confirmed" boolean DEFAULT false NOT NULL,
	"version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "unit_results" (
	"election_id" uuid,
	"polling_unit_id" integer,
	"status" "unit_status" DEFAULT 'not_confirmed'::"unit_status" NOT NULL,
	"counted_version_id" uuid,
	"resolved_by" uuid,
	"resolution_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_results_pkey" PRIMARY KEY("election_id","polling_unit_id")
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lga_id" integer NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "declarations_area_idx" ON "declarations" ("election_id","level","area_code");--> statement-breakpoint
CREATE INDEX "lgas_state_idx" ON "lgas" ("state_id");--> statement-breakpoint
CREATE INDEX "polling_units_ward_idx" ON "polling_units" ("ward_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_versions_unit_figures_uq" ON "result_versions" ("election_id","polling_unit_id","figures_hash");--> statement-breakpoint
CREATE INDEX "submissions_unit_idx" ON "submissions" ("election_id","polling_unit_id");--> statement-breakpoint
CREATE INDEX "submissions_reporter_idx" ON "submissions" ("reporter_id");--> statement-breakpoint
CREATE INDEX "wards_lga_idx" ON "wards" ("lga_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_reporter_id_reporters_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "reporters"("id");--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_entered_by_admin_users_id_fkey" FOREIGN KEY ("entered_by") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_approved_by_admin_users_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "election_parties" ADD CONSTRAINT "election_parties_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "election_parties" ADD CONSTRAINT "election_parties_party_id_parties_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id");--> statement-breakpoint
ALTER TABLE "lgas" ADD CONSTRAINT "lgas_state_id_states_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id");--> statement-breakpoint
ALTER TABLE "polling_units" ADD CONSTRAINT "polling_units_ward_id_wards_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id");--> statement-breakpoint
ALTER TABLE "rejection_log" ADD CONSTRAINT "rejection_log_reporter_id_reporters_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "reporters"("id");--> statement-breakpoint
ALTER TABLE "rejection_log" ADD CONSTRAINT "rejection_log_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "result_versions" ADD CONSTRAINT "result_versions_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "result_versions" ADD CONSTRAINT "result_versions_polling_unit_id_polling_units_id_fkey" FOREIGN KEY ("polling_unit_id") REFERENCES "polling_units"("id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_polling_unit_id_polling_units_id_fkey" FOREIGN KEY ("polling_unit_id") REFERENCES "polling_units"("id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reporter_id_reporters_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "reporters"("id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_version_id_result_versions_id_fkey" FOREIGN KEY ("version_id") REFERENCES "result_versions"("id");--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_election_id_elections_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id");--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_polling_unit_id_polling_units_id_fkey" FOREIGN KEY ("polling_unit_id") REFERENCES "polling_units"("id");--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_counted_version_id_result_versions_id_fkey" FOREIGN KEY ("counted_version_id") REFERENCES "result_versions"("id");--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_resolved_by_admin_users_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_lga_id_lgas_id_fkey" FOREIGN KEY ("lga_id") REFERENCES "lgas"("id");