CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "polling_units" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "polling_units" pu
SET "search_text" = trim(regexp_replace(lower(regexp_replace(pu."name" || ' ' || w."name" || ' ' || l."name" || ' ' || s."name", '[''’]', '', 'g')), '[^a-z0-9]+', ' ', 'g'))
FROM "wards" w, "lgas" l, "states" s
WHERE w."id" = pu."ward_id" AND l."id" = w."lga_id" AND s."id" = l."state_id";--> statement-breakpoint
CREATE INDEX "polling_units_search_idx" ON "polling_units" USING gin ("search_text" gin_trgm_ops);
