ALTER TABLE "result_versions" ADD COLUMN "stamped_witness_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "result_versions" ADD COLUMN "strong_witness_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "result_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "witness_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "confidence" "confidence_level";--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "version_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "flags" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX "submissions_unit_status_idx" ON "submissions" ("election_id","polling_unit_id","status");--> statement-breakpoint
CREATE INDEX "unit_results_status_idx" ON "unit_results" ("election_id","status");