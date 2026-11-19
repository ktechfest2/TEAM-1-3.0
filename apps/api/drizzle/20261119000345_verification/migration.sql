ALTER TYPE "submission_status" ADD VALUE 'needs_confirmation' BEFORE 'rejected';--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "retake_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "model" text;--> statement-breakpoint
CREATE INDEX "submissions_pending_idx" ON "submissions" ("status","next_attempt_at");