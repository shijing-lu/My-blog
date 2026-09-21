-- ============================================================================
-- 云端 PostgreSQL：为 D4 同步补齐 `updated_at` 列（LWW 裁决依据）
--
-- 为什么是手工 SQL 而不是 drizzle-kit 迁移：
--   本项目的 pg 迁移日志已落后于 schema（drizzle-kit generate 会连同历史漂移一起生成：
--   5 张表的 CREATE TABLE + 3 个旧字段），直接跑生产库会报「表已存在」。
--   本脚本写成**幂等**形式（IF NOT EXISTS），可安全地重复执行。
--
-- 执行方式（任选其一）：
--   psql "$DATABASE_URL" -f scripts/pg-add-updated-at.sql
--   或在 Supabase / Neon 控制台的 SQL 编辑器里整段粘贴执行
--
-- ⚠️ 执行前请确认备份；本脚本只加列 + 回填，不删数据。
-- ============================================================================

-- 1) 加列（幂等）
ALTER TABLE "calendar_events"      ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "checkin_tasks"        ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "comments"             ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "doc_bundles"          ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "doc_categories"       ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "github_users"         ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "nav_sub_categories"   ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "photos"               ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "todos"                ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "web_categories"       ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "websites"             ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "admin_applications"   ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "article_categories"   ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "article_post_categories" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

-- 2) 回填：无 updated_at 的历史行用 created_at（保证 LWW 有可比的时间基准）
UPDATE "calendar_events"      SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "checkin_tasks"        SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "comments"             SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "doc_bundles"          SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "doc_categories"       SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "github_users"         SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "nav_sub_categories"   SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "photos"               SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "todos"                SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "web_categories"       SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "websites"             SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "admin_applications"   SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "article_categories"   SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "article_post_categories" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

-- 3) 校验：应返回 0 行（即没有 updated_at 为空的行）
-- SELECT 'calendar_events' AS t, COUNT(*) AS missing FROM "calendar_events" WHERE "updated_at" IS NULL
-- UNION ALL SELECT 'photos', COUNT(*) FROM "photos" WHERE "updated_at" IS NULL
-- UNION ALL SELECT 'comments', COUNT(*) FROM "comments" WHERE "updated_at" IS NULL;
