/**
 * 运行方言判断（独立模块，避免 schema ↔ db/index 循环依赖）
 *
 * 连接串取值优先级：
 *   - 开发（默认）：项目根 `.env` 优先于进程环境变量
 *     （Astro 不会把 .env 写入 process.env，若系统里残留失效的 DATABASE_URL
 *      会覆盖本地配置导致误连 PostgreSQL；生产 Vercel 无 .env，自然回落进程变量）
 *   - **桌面端（DESKTOP_MODE=1）：进程环境变量优先**
 *     桌面端由 Electron 主进程显式注入 DATABASE_URL（指向用户数据目录的本地库）。
 *     若仍让 `.env` 优先，便携版的"项目根"恰好是仓库目录时就会读到
 *     `file:./data/blog.db`，把开发库当成桌面端本地库
 *     —— 实测踩坑：桌面端读写的是仓库开发库，还把它独有的开发数据推送到了云端。
 *   兜底：默认 `file:./data/blog.db`
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

/** 桌面端标记（Electron 主进程注入）：此时进程环境变量优先于 .env 文件 */
const isDesktopMode = process.env.DESKTOP_MODE === '1';

/** 读取数据库连接串 */
export function readDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  const fromFile = readEnvFileValue('DATABASE_URL')?.trim();
  return (isDesktopMode ? fromEnv || fromFile : fromFile || fromEnv) || 'file:./data/blog.db';
}

/**
 * 读取「备用」数据库连接串（故障转移用，可选）。
 * 未配置时返回空串，故障转移层据此判断只有单一端点。
 */
export function readFallbackDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL_FALLBACK?.trim();
  const fromFile = readEnvFileValue('DATABASE_URL_FALLBACK')?.trim();
  return (isDesktopMode ? fromEnv || fromFile : fromFile || fromEnv) || '';
}

/** 是否为 PostgreSQL（生产） */
export const isPostgres: boolean = /^postgres(ql)?:\/\//.test(readDatabaseUrl());

/** 是否为 PostgreSQL 连接串（供备用端点按自身串判断方言） */
export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//.test(url);
}
