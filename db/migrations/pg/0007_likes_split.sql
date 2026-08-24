-- 点赞表升级：GitHub 登录与匿名分开计数
-- 仅当已执行过旧版 0006（likes 含 fingerprint 列）时需要执行本迁移；
-- 若直接执行新版 0006（含 user_type/user_ident），请跳过本文件。
ALTER TABLE "likes" ADD COLUMN "user_type" text DEFAULT 'anonymous' NOT NULL;
ALTER TABLE "likes" ADD COLUMN "user_ident" text DEFAULT '' NOT NULL;
UPDATE "likes" SET "user_ident" = "fingerprint" WHERE "user_ident" = '' AND "fingerprint" <> '';
ALTER TABLE "likes" DROP CONSTRAINT "likes_target_fingerprint_unique";
ALTER TABLE "likes" ADD CONSTRAINT "likes_target_user_unique" UNIQUE("target_type","target_id","user_type","user_ident");
ALTER TABLE "likes" DROP COLUMN "fingerprint";
