CREATE TABLE "mindmaps" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"article_id" text,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mindmaps_article_idx" ON "mindmaps" USING btree ("article_id");
