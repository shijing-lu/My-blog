CREATE TABLE "web_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "websites" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"icon" text,
	"desc" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "web_categories_sort_idx" ON "web_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "websites_category_idx" ON "websites" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "websites_sort_idx" ON "websites" USING btree ("sort");