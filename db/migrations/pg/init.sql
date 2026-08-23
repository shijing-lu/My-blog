-- ============================================================
-- My-Blog PostgreSQL 初始化（合并版，Vercel Postgres 控制台粘贴执行）
-- 由 drizzle-kit 生成的 0000 + 0001 迁移合并而成
-- 包含：articles（含 cover 列） / images / photos
-- ============================================================

CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'tech' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_type_check" CHECK ("articles"."type" in ('tech', 'note', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


-- ------------------------------------------------------------
-- 0001：影集 photos 表
-- ------------------------------------------------------------

CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"thumb_url" text,
	"title" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

