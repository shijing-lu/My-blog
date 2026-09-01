/**
 * POST /api/sync-databases —— 主备数据库对账同步（管理员，中间件保护）
 *
 * 用于双写失败/熔断窗口后的自愈：主→备（主库权威）+ 备→主（回填不丢）。
 */
import type { APIRoute } from 'astro';
import { syncDatabases } from '@/lib/db-sync';
import { json } from '@/lib/api';

export const prerender = false;

/** 允许更长的执行时间（Hobby 上限 60s，Pro 可到 300s；超时重跑即可，对账幂等） */
export const config = { maxDuration: 300 };

export const POST: APIRoute = async () => {
  const primaryUrl = process.env.DATABASE_URL;
  const fallbackUrl = process.env.DATABASE_URL_FALLBACK;
  if (!primaryUrl || !fallbackUrl || !/^postgres(ql)?:\/\//.test(primaryUrl) || !/^postgres(ql)?:\/\//.test(fallbackUrl)) {
    return json({ error: '缺少数据库连接串（DATABASE_URL / DATABASE_URL_FALLBACK）' }, 500);
  }
  try {
    const results = await syncDatabases({ primaryUrl, fallbackUrl, apply: true });
    return json({ ok: true, results });
  } catch (err) {
    console.error('[api/sync-databases]', err);
    return json({ error: (err as Error).message }, 500);
  }
};
