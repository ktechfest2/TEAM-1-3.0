ALTER TABLE "reporters" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "reporters" ADD COLUMN "blocked_by" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "image_dhash" text;