CREATE TABLE "study_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"duration_sec" integer NOT NULL,
	"completed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"est_pomodoros" integer DEFAULT 1 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_distractions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "study_sessions_task_idx" ON "study_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "study_sessions_created_idx" ON "study_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "study_tasks_created_idx" ON "study_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "study_distractions_created_idx" ON "study_distractions" USING btree ("created_at");
