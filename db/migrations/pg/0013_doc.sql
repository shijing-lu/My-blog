CREATE TABLE "doc_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"summary" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "doc_categories_sort_idx" ON "doc_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "doc_bundles_category_idx" ON "doc_bundles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "doc_bundles_sort_idx" ON "doc_bundles" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "doc_articles_bundle_idx" ON "doc_articles" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "doc_articles_sort_idx" ON "doc_articles" USING btree ("sort");
