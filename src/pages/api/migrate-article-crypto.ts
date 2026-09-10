/**
 * POST /api/migrate-article-crypto —— 一次性迁移：articles 表补加密列（管理员）
 *
 * 背景（与 migrate-photos-tags 同因）：生产双库（主 Neon、备 Supabase）的连接串被
 * Vercel 标记为 Sensitive，CLI 拉不到明文，无法本地直连执行 DDL。故提供本端点，
 * 借生产函数运行时的环境变量完成迁移。
 *
 * 补三列：
 * - `encrypted`     boolean/int，默认 false（是否启用加密）
 * - `encrypt_hint`  text，默认 ''（密码提示语）
 * - `encrypt_meta`  text，默认 ''（salt/iv/ciphertext JSON）
 *
 * 用法：管理员登录后 POST 本端点一次即可；幂等，可重复执行。
 * ⚠️ 必须在部署业务代码**之前**完成迁移，否则文章查询会因缺列失败。
 * 迁移确认成功后可删除本文件（同时移除 middleware.ts 中的保护条目）。
 */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 待补列（PG 用 ADD COLUMN IF NOT EXISTS，天然幂等） */
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'encrypted', ddl: "ALTER TABLE articles ADD COLUMN IF NOT EXISTS encrypted boolean NOT NULL DEFAULT false" },
  { name: 'encrypt_hint', ddl: "ALTER TABLE articles ADD COLUMN IF NOT EXISTS encrypt_hint text NOT NULL DEFAULT ''" },
  { name: 'encrypt_meta', ddl: "ALTER TABLE articles ADD COLUMN IF NOT EXISTS encrypt_meta text NOT NULL DEFAULT ''" },
];

/**
 * 对单个端点执行全部 DDL，并复核列确实存在。
 *
 * @param label 端点标识（primary / fallback）
 * @param url 连接串
 * @returns 执行结果
 */
async function migrateUrl(label: string, url: string): Promise<Record<string, unknown>> {
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    const applied: string[] = [];
    for (const col of COLUMNS) {
      await client.unsafe(col.ddl);
      applied.push(col.name);
    }
    // 复核三列均已存在
    const cols = await client.unsafe<{ column_name: string }[]>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'articles' AND column_name IN ('encrypted','encrypt_hint','encrypt_meta')",
    );
    const found = cols.map((c) => c.column_name).sort();
    const ok = found.length === COLUMNS.length;
    return { target: label, ok, applied, found };
  } catch (err) {
    return { target: label, ok: false, error: (err as Error).message };
  } finally {
    await client.end({ timeout: 5 });
  }
}

export const POST: APIRoute = async (context) => {
  if (!(await isManagerSession(context.cookies))) return json({ error: '未登录' }, 401);

  const primaryUrl = process.env.DATABASE_URL;
  const fallbackUrl = process.env.DATABASE_URL_FALLBACK;
  if (!primaryUrl || !/^postgres(ql)?:\/\//.test(primaryUrl)) {
    return json({ error: '缺少 DATABASE_URL（生产 PG 连接串）' }, 500);
  }

  const results = [await migrateUrl('primary', primaryUrl)];
  if (fallbackUrl && /^postgres(ql)?:\/\//.test(fallbackUrl)) {
    results.push(await migrateUrl('fallback', fallbackUrl));
  }

  const allOk = results.every((r) => r.ok);
  return json({ ok: allOk, columns: COLUMNS.map((c) => c.name), results }, allOk ? 200 : 500);
};
