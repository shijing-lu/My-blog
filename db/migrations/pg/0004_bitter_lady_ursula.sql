ALTER TABLE "calendar_events" ADD COLUMN "lunar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "lunar_date" text;