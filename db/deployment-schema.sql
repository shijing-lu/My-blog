CREATE TABLE "admin_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"login" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"permissions" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_accounts_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "admin_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"login" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "admin_applications_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "ai_bond" (
	"id" text PRIMARY KEY NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"active_days" integer DEFAULT 0 NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"max_streak" integer DEFAULT 0 NOT NULL,
	"depth_score" integer DEFAULT 0 NOT NULL,
	"bond_points" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"last_active_date" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"depth_score" integer DEFAULT 0 NOT NULL,
	"summarized" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"content" text NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"source_conversation_id" text DEFAULT '' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"color" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_post_categories" (
	"article_id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_views" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'tech' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"encrypt_hint" text DEFAULT '' NOT NULL,
	"encrypt_meta" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_type_check" CHECK ("articles"."type" in ('tech', 'note', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "cadence_records" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"record_id" text NOT NULL,
	"payload" text,
	"revision" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"date" text NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"lunar" boolean DEFAULT false NOT NULL,
	"lunar_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkin_records" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_records_task_date_unique" UNIQUE("task_id","date")
);
--> statement-breakpoint
CREATE TABLE "checkin_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"max_makeup_days" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"parent_id" text,
	"content" text DEFAULT '' NOT NULL,
	"author_type" text DEFAULT 'anonymous' NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"github_user_id" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_entries_date_unique" UNIQUE("date")
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
CREATE TABLE "doc_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"summary" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"family_name" text NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"login" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text DEFAULT '' NOT NULL,
	"key" text,
	"url" text,
	"thumb_key" text,
	"thumb_url" text,
	"width" integer,
	"height" integer,
	"size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"user_type" text DEFAULT 'anonymous' NOT NULL,
	"user_ident" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_target_user_unique" UNIQUE("target_type","target_id","user_type","user_ident")
);
--> statement-breakpoint
CREATE TABLE "mindmaps" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"article_id" text,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"media" text DEFAULT '[]' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_sub_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"key" text,
	"thumb_url" text,
	"thumb_key" text,
	"title" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
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
CREATE TABLE "todos" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "websites" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"sub_category_id" text,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"icon" text,
	"desc" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_conversations_updated_idx" ON "ai_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_memories_rank_idx" ON "ai_memories" USING btree ("importance","updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "article_categories_sort_idx" ON "article_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "article_categories_parent_idx" ON "article_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "article_post_categories_category_idx" ON "article_post_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "article_views_article_idx" ON "article_views" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "checkin_records_task_idx" ON "checkin_records" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "checkin_tasks_sort_idx" ON "checkin_tasks" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "doc_articles_bundle_idx" ON "doc_articles" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "doc_articles_sort_idx" ON "doc_articles" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "doc_bundles_category_idx" ON "doc_bundles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "doc_bundles_sort_idx" ON "doc_bundles" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "doc_categories_sort_idx" ON "doc_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "doc_nodes_bundle_idx" ON "doc_nodes" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "doc_nodes_parent_idx" ON "doc_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "doc_nodes_sort_idx" ON "doc_nodes" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "mindmaps_article_idx" ON "mindmaps" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "nav_sub_categories_category_idx" ON "nav_sub_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "nav_sub_categories_sort_idx" ON "nav_sub_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "study_distractions_created_idx" ON "study_distractions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "study_sessions_task_idx" ON "study_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "study_sessions_created_idx" ON "study_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "study_tasks_created_idx" ON "study_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "web_categories_sort_idx" ON "web_categories" USING btree ("sort");--> statement-breakpoint
CREATE INDEX "websites_category_idx" ON "websites" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "websites_sub_category_idx" ON "websites" USING btree ("sub_category_id");--> statement-breakpoint
CREATE INDEX "websites_sort_idx" ON "websites" USING btree ("sort");
