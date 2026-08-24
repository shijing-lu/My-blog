/**
 * 运行方言判断（独立模块，避免 schema ↔ db/index 循环依赖）
 *
 * 连接串取值优先级：
 *   1. 项目根 `.env` 文件中的 DATABASE_URL（本地配置优先——Astro 不会把 .env
 *      写入 process.env，若系统环境变量里残留失效的 DATABASE_URL 会覆盖本地配置，
 *      导致本地误连 PostgreSQL；生产 Vercel 无 .env，自然回落进程环境变量）
 *   2. 系统/进程环境变量 DATABASE_URL
 *   3. 默认 `file:./data/blog.db`（本地 SQLite）
 *
 * 以 `postgres://`/`postgresql://` 开头 → PostgreSQL（生产）；其余 → SQLite（开发）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 从项目根 .env 读取指定键（支持引号包裹，忽略注释行） */
function readEnvFileValue(key: string): string | undefined {
  try {
    const raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[1] !== key) continue;
      let v = m[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v || undefined;
    }
  } catch {
    /* 无 .env 文件 */
  }
  return undefined;
}

/** 读取数据库连接串 */
export function readDatabaseUrl(): string {
  return (
    readEnvFileValue('DATABASE_URL')?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    'file:./data/blog.db'
  );
}

/** 是否为 PostgreSQL（生产） */
export const isPostgres: boolean = /^postgres(ql)?:\/\//.test(readDatabaseUrl());
