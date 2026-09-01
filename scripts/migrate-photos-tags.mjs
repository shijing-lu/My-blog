/**
 * 构建期幂等迁移：photos 表补 tags 列（主备双库）。
 *
 * 背景：Vercel 生产环境变量标记为 Sensitive，CLI/API 读不到明文，
 * 本地无法直连生产库跑 DDL；但构建环境与运行时函数都能拿到真实连接串。
 * 因此把 `ALTER TABLE photos ADD COLUMN IF NOT EXISTS tags ...` 挂在
 * `pnpm build` 前执行 —— 每次部署自动保证 schema 就位，幂等可重复跑。
 *
 * 行为约定（此脚本**永不抛错**，避免阻塞部署）：
 * - DATABASE_URL 非 postgres:// 时（本地 SQLite 开发）直接跳过
 * - 单个端点失败只打日志，继续处理另一个端点
 * - 兜底：线上还有管理员端点 POST /api/migrate-photos-tags 可手动触发
 */
import postgres from 'postgres';

const DDL = `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "tags" text NOT NULL DEFAULT '[]'`;

async function migrateEndpoint(name, url) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.log(`[migrate-photos-tags] ${name}: 非 PG 连接串，跳过`);
    return { name, skipped: true };
  }
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await sql.unsafe(DDL);
    // 双确认：列真的存在
    const check = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'photos' AND column_name = 'tags'`;
    const ok = check[0]?.n > 0;
    console.log(`[migrate-photos-tags] ${name}: ${ok ? '✓ tags 列就位' : '⚠ 校验未通过'}`);
    return { name, ok };
  } catch (err) {
    console.warn(`[migrate-photos-tags] ${name}: 迁移失败 - ${err.message}`);
    return { name, error: err.message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const primary = process.env.DATABASE_URL;
const fallback = process.env.DATABASE_URL_FALLBACK;

if (!primary && !fallback) {
  console.log('[migrate-photos-tags] 未配置数据库连接串，跳过');
} else {
  const results = [];
  if (primary) results.push(await migrateEndpoint('primary', primary));
  if (fallback) results.push(await migrateEndpoint('fallback', fallback));
  console.log('[migrate-photos-tags] 结果:', JSON.stringify(results));
}
