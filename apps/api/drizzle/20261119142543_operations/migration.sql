ALTER TABLE "incident_reports" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "review_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unit_results" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_assigned_to_admin_users_id_fkey" FOREIGN KEY ("assigned_to") REFERENCES "admin_users"("id");--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_assigned_to_admin_users_id_fkey" FOREIGN KEY ("assigned_to") REFERENCES "admin_users"("id");