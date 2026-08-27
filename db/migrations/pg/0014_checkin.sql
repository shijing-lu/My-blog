CREATE TABLE "checkin_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"max_makeup_days" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkin_records" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "checkin_tasks_sort_idx" ON "checkin_tasks" USING btree ("sort");--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_records_task_date_unique" ON "checkin_records" USING btree ("task_id","date");--> statement-breakpoint
CREATE INDEX "checkin_records_task_idx" ON "checkin_records" USING btree ("task_id");
