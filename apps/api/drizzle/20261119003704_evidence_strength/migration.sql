CREATE TYPE "evidence_strength" AS ENUM('strong', 'standard', 'low');--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "evidence_strength" "evidence_strength";