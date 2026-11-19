CREATE TABLE "chain_anchors" (
	"id" serial PRIMARY KEY,
	"seq" bigint NOT NULL UNIQUE,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"external_provider" text,
	"external_proof" text
);
--> statement-breakpoint
ALTER TABLE "chain_entries" ADD COLUMN "payload" text NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_entries" ALTER COLUMN "seq" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE "chain_entries_seq_seq";--> statement-breakpoint
ALTER TABLE "chain_entries" ALTER COLUMN "seq" SET DATA TYPE bigint USING "seq"::bigint;--> statement-breakpoint
ALTER TABLE "chain_entries" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "chain_entries_ref_idx" ON "chain_entries" ("entry_type","ref_id","seq");--> statement-breakpoint
CREATE FUNCTION "trustelect_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "chain_entries_append_only" BEFORE UPDATE OR DELETE ON "chain_entries" FOR EACH ROW EXECUTE FUNCTION "trustelect_append_only"();--> statement-breakpoint
CREATE TRIGGER "chain_entries_no_truncate" BEFORE TRUNCATE ON "chain_entries" FOR EACH STATEMENT EXECUTE FUNCTION "trustelect_append_only"();--> statement-breakpoint
CREATE TRIGGER "chain_anchors_append_only" BEFORE UPDATE OR DELETE ON "chain_anchors" FOR EACH ROW EXECUTE FUNCTION "trustelect_append_only"();--> statement-breakpoint
CREATE TRIGGER "chain_anchors_no_truncate" BEFORE TRUNCATE ON "chain_anchors" FOR EACH STATEMENT EXECUTE FUNCTION "trustelect_append_only"();
