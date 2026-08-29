-- 点赞表升级：GitHub 登录与匿名分开计数
-- 幂等版：无论已执行旧版 0006（likes 含 fingerprint）还是新版 0006（含 user_type/user_ident），
-- 本迁移都能安全跑过：列已存在则跳过；fingerprint 列存在时才迁移数据并清理。
ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "user_type" text DEFAULT 'anonymous' NOT NULL;
ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "user_ident" text DEFAULT '' NOT NULL;

-- 仅当存在旧版 fingerprint 列时：迁移历史指纹数据并清理旧列/旧约束
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'likes' AND column_name = 'fingerprint'
  ) THEN
    UPDATE "likes"
      SET "user_ident" = "fingerprint"
      WHERE "user_ident" = '' AND "fingerprint" <> '';
    ALTER TABLE "likes" DROP CONSTRAINT IF EXISTS "likes_target_fingerprint_unique";
    ALTER TABLE "likes" DROP COLUMN IF EXISTS "fingerprint";
  END IF;
END $$;

-- 幂等地确保新唯一约束存在（先删后建，定义一致）
ALTER TABLE "likes" DROP CONSTRAINT IF EXISTS "likes_target_user_unique";
ALTER TABLE "likes" ADD CONSTRAINT "likes_target_user_unique" UNIQUE("target_type","target_id","user_type","user_ident");
