/**
 * POST /api/migrate-photos-tags —— 一次性迁移：photos 表补 tags 列（管理员）
 *
 * 背景：图片标签功能的 `photos.tags` 列尚未在生产双库（主 Vercel/Neon、备 Supabase）
 * 落地，而生产连接串被 Vercel 标记为 Sensitive、CLI 拉不到明文，无法本地直连执行
 * DDL。故提供本端点，借生产函数运行时的环境变量完成迁移。
 *
 * 用法：管理员登录后 POST 本端点一次即可；幂等，可重复执行。
 * 迁移确认成功后可删除本文件（同时移除 middleware.ts 中的保护条目）。
 */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';

export const prerender = false;

export const config = { maxDuration: 60 };

const DDL = 'ALTER TABLE photos ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT \'[]\'';

async function migrateUrl(label: string, url: string): Promise<Record<string, unknown>> {
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await client.unsafe(DDL);
    // 复核列确实存在
    const cols = await client.unsafe<{ column_name: string }[]>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'photos' AND column_name = 'tags'",
    );
    return { target: label, ok: true, columnExists: cols.length > 0 };
  } catch (err) {
    return { target: label, ok: false, error: (err as Error).message };
  } finally {
    await client.end({ timeout: 5 });
  }
}

export const POST: APIRoute = async (context) => {
  if (!verifyRequest(context.cookies)) return json({ error: '未登录' }, 401);

  const primaryUrl = process.env.DATABASE_URL;
  const fallbackUrl = process.env.DATABASE_URL_FALLBACK;
  if (!primaryUrl || !/^postgres(ql)?:\/\//.test(primaryUrl)) {
    return json({ error: '缺少 DATABASE_URL' }, 500);
  }

  const results = [await migrateUrl('primary', primaryUrl)];
  if (fallbackUrl && /^postgres(ql)?:\/\//.test(fallbackUrl)) {
    results.push(await migrateUrl('fallback', fallbackUrl));
  }

  const allOk = results.every((r) => r.ok);
  return json({ ok: allOk, ddl: DDL, results }, allOk ? 200 : 500);
};
