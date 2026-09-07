/**
 * 构建期幂等迁移：授权管理两张新表（主备双库）。
 *
 * - admin_accounts：GitHub 授权管理员（role top/admin + permissions JSON）
 * - admin_applications：访客管理员权限申请（pending/approved/rejected）
 *
 * 与 migrate-moments-visibility.mjs 同一模式：挂在 `pnpm build` 前执行，
 * 每次部署自动保证 schema 就位，幂等可重复跑，永不抛错。
 * - DATABASE_URL 非 postgres:// 时（本地 SQLite 开发）跳过；
 * - 本地 SQLite 建表由 scripts/admin-auth-sqlite.mjs / drizzle push 负责。
 */
import postgres from 'postgres';

const DDL = `
CREATE TABLE IF NOT EXISTS "admin_accounts" (
  "id" text PRIMARY KEY,
  "github_id" integer NOT NULL UNIQUE,
  "login" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "avatar_url" text NOT NULL DEFAULT '',
  "role" text NOT NULL DEFAULT 'admin',
  "permissions" text NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "admin_applications" (
  "id" text PRIMARY KEY,
  "github_id" integer NOT NULL UNIQUE,
  "login" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "avatar_url" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp
);
`;

async function migrateEndpoint(name, url) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.log(`[migrate-admin-auth] ${name}: 非 PG 连接串，跳过`);
    return { name, skipped: true };
  }
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await sql.unsafe(DDL);
    const check = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_name IN ('admin_accounts', 'admin_applications')`;
    const ok = check[0]?.n >= 2;
    console.log(`[migrate-admin-auth] ${name}: ${ok ? '✓ 两张表就位' : '⚠ 校验未通过'}`);
    return { name, ok };
  } catch (err) {
    console.warn(`[migrate-admin-auth] ${name}: 迁移失败 - ${err.message}`);
    return { name, error: err.message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const primary = process.env.DATABASE_URL;
const fallback = process.env.DATABASE_URL_FALLBACK;

if (!primary && !fallback) {
  console.log('[migrate-admin-auth] 未配置数据库连接串，跳过');
} else {
  const results = [];
  if (primary) results.push(await migrateEndpoint('primary', primary));
  if (fallback) results.push(await migrateEndpoint('fallback', fallback));
  console.log('[migrate-admin-auth] 结果:', JSON.stringify(results));
}
