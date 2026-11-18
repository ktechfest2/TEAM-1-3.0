CREATE TABLE "voter_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"phone_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "image_bytes" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "image_type" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "location_accuracy" double precision;--> statement-breakpoint
DROP INDEX "submissions_reporter_idx";--> statement-breakpoint
CREATE INDEX "submissions_reporter_idx" ON "submissions" ("reporter_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_reporter_client_uq" ON "submissions" ("reporter_id","client_id");--> statement-breakpoint
CREATE INDEX "voter_otps_phone_idx" ON "voter_otps" ("phone_hash","created_at");