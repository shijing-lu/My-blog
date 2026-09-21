/**
 * 在云端 PostgreSQL 上执行 SQL 文件（D4 补列迁移用）
 *
 * 用法（三选一，按"最省事 → 最灵活"排序）：
 *   1. node scripts/run-pg-sql.mjs --from-desktop-config scripts/pg-add-updated-at.sql
 *      ↑ 直接读取 %APPDATA%\byqx-blog-desktop\config.json 里的 SYNC_DATABASE_URL（推荐）
 *   2. node scripts/run-pg-sql.mjs scripts/pg-add-updated-at.sql
 *      ↑ 读取环境变量 DATABASE_URL（先 $env:DATABASE_URL='postgres://...' 再执行）
 *   3. node scripts/run-pg-sql.mjs "postgres://user:pass@host:5432/db" scripts/pg-add-updated-at.sql
 *      ↑ 连接串作为第一个参数直接给出
 *
 * 说明：
 * - 用项目自带的 postgres 驱动（无需安装 psql）；
 * - 逐条语句顺序执行，`--` 开头的注释行与空语句自动跳过；
 * - 遇到错误立即停止并打印**失败语句**，已执行成功的语句不会回滚（脚本是幂等的，
 *   因此可直接重跑）；
 * - 执行前后会打印校验结果：14 张表的 updated_at 缺失行数（应为 0）。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const args = process.argv.slice(2);

/**
 * 从桌面端配置读取连接串（避免把密码贴在命令行/聊天里）
 * @param {string} key 配置键名（SYNC_DATABASE_URL | SYNC_DATABASE_URL_FALLBACK）
 */
function fromDesktopConfig(key = 'SYNC_DATABASE_URL') {
  const dir = path.join(process.env.APPDATA || '', 'byqx-blog-desktop');
  const file = path.join(dir, 'config.json');
  if (!existsSync(file)) return null;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    return cfg[key] || null;
  } catch {
    return null;
  }
}

let url = null;
let sqlFile = null;

if (args.includes('--from-desktop-config')) {
  const key = args.includes('--fallback') ? 'SYNC_DATABASE_URL_FALLBACK' : 'SYNC_DATABASE_URL';
  url = fromDesktopConfig(key);
  sqlFile = args.filter((a) => a !== '--from-desktop-config' && a !== '--fallback')[0] ?? null;
  if (!url) {
    console.error(`未找到桌面端配置里的 ${key}：%APPDATA%\\byqx-blog-desktop\\config.json`);
    process.exit(1);
  }
  console.log(`使用配置项：${key}`);
} else if (args.length >= 2 && args[0].startsWith('postgres')) {
  url = args[0];
  sqlFile = args[1];
} else {
  url = process.env.DATABASE_URL || null;
  sqlFile = args[0] ?? null;
}

if (!url) {
  console.error('缺少数据库连接串：请用 --from-desktop-config，或设置 DATABASE_URL 环境变量，或直接把 URL 作为第一个参数传入');
  process.exit(1);
}
// 拦住明显无效的占位串（例如桌面端配置模板里的 postgres://TODO-…），避免"连上了假库"还继续执行
const looksReal = /^postgres(ql)?:\/\/.+@[^/@]+\/?/.test(url) && !/TODO|待填|用户名/i.test(url);
if (!looksReal) {
  console.error(`连接串看起来不是有效的云端地址：${url}`);
  console.error('请先在 %APPDATA%\\byqx-blog-desktop\\config.json 填入真实的 SYNC_DATABASE_URL（postgres://用户:密码@主机:5432/库名）。');
  process.exit(1);
}
if (!sqlFile || !existsSync(sqlFile)) {
  console.error(`SQL 文件不存在：${sqlFile}`);
  process.exit(1);
}

const TABLES = [
  'calendar_events', 'checkin_tasks', 'comments', 'doc_bundles', 'doc_categories',
  'github_users', 'nav_sub_categories', 'photos', 'todos', 'web_categories',
  'websites', 'admin_applications', 'article_categories', 'article_post_categories',
];

const sql = postgres(url, { max: 1, connect_timeout: 15 });

try {
  const raw = readFileSync(sqlFile, 'utf8');
  // 先剔除整行注释（含文件头说明），再按 ';' 切分，避免注释被当成语句执行
  const withoutComments = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`连接串主机：${new URL(url.replace(/^postgres(ql)?/, 'http')).host}`);
  console.log(`待执行语句：${statements.length} 条\n`);

  for (let i = 0; i < statements.length; i += 1) {
    const stmt = statements[i];
    const head = stmt.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await sql.unsafe(`${stmt};`);
      console.log(`  ✓ [${i + 1}/${statements.length}] ${head}…`);
    } catch (err) {
      console.error(`  ✗ [${i + 1}/${statements.length}] 失败：${head}`);
      console.error(`     ${err.message}`);
      console.error('\n已成功的语句不会回滚；本脚本幂等，修复后可直接重跑。');
      process.exit(1);
    }
  }

  console.log('\n=== 校验：各表 updated_at 缺失行数（应全为 0） ===');
  for (const t of TABLES) {
    try {
      const rows = await sql.unsafe(`SELECT COUNT(*)::int AS missing FROM "${t}" WHERE "updated_at" IS NULL`);
      const missing = rows[0]?.missing ?? -1;
      console.log(`  ${missing === 0 ? '✓' : '✗'} ${t}: ${missing}`);
    } catch (err) {
      console.log(`  ? ${t}: 校验失败（${err.message}）`);
    }
  }
  console.log('\n完成：云端 updated_at 已补齐并回填。');
} finally {
  await sql.end().catch(() => {});
}
