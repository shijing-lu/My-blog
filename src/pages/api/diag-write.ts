/** 临时诊断：直接对 PG 执行 encrypted 写入，观察是否生效 */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';

export const prerender = false;
export const config = { maxDuration: 60 };

export const GET: APIRoute = async ({ cookies, url }) => {
  if (!(await isManagerSession(cookies))) return json({ error: '未登录' }, 401);
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ error: 'no url' }, 500);
  const client = postgres(conn, { max: 1, connect_timeout: 15 });
  try {
    const slug = url.searchParams.get('slug');
    if (!slug) return json({ error: 'need ?slug=' }, 400);
    // 读当前值
    const before = await client.unsafe('SELECT id, encrypted, length(encrypt_meta) AS meta FROM articles WHERE slug = $1', [slug]);
    // 直接 UPDATE 为 true
    const upd = await client.unsafe('UPDATE articles SET encrypted = true WHERE slug = $1 RETURNING id, encrypted', [slug]);
    // 再读
    const after = await client.unsafe('SELECT id, encrypted FROM articles WHERE slug = $1', [slug]);
    // 用参数化方式再试（模拟 drizzle 的 $2 绑定）
    const upd2 = await client.unsafe('UPDATE articles SET encrypted = $1 WHERE slug = $2 RETURNING encrypted', [false, slug]);
    const after2 = await client.unsafe('SELECT encrypted FROM articles WHERE slug = $1', [slug]);
    return json({ ok: true, before, upd, after, upd2, after2 });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await client.end({ timeout: 5 });
  }
};
