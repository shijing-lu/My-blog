/**
 * 主备数据库对账同步 CLI（默认干跑，--apply 真正同步）
 *
 * 用法：
 *   npx tsx scripts/sync-databases.mts --primary-url "postgres://..." --fallback-url "postgres://..."
 *   npx tsx scripts/sync-databases.mts --apply          # 用环境变量 DATABASE_URL / DATABASE_URL_FALLBACK
 */
import { syncDatabases } from '../src/lib/db-sync';

const APPLY = process.argv.includes('--apply');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const primaryUrl = arg('--primary-url') ?? process.env.DATABASE_URL;
const fallbackUrl = arg('--fallback-url') ?? process.env.DATABASE_URL_FALLBACK;
if (!primaryUrl || !fallbackUrl || !/^postgres(ql)?:\/\//.test(primaryUrl) || !/^postgres(ql)?:\/\//.test(fallbackUrl)) {
  console.error('需要两个 Postgres 连接串：--primary-url / --fallback-url（或环境变量 DATABASE_URL / DATABASE_URL_FALLBACK）');
  process.exit(1);
}

console.log(`模式：${APPLY ? 'APPLY（实际同步）' : 'DRY-RUN（仅预览）'}`);
const results = await syncDatabases({ primaryUrl, fallbackUrl, apply: APPLY });
for (const r of results) {
  console.log(
    r.skipped
      ? `[跳过 ${r.table}] ${r.skipped}`
      : `[${r.table}] 主→备 ${r.toFallback} 行 · 备→主 ${r.toPrimary} 行`,
  );
}
process.exit(0);
