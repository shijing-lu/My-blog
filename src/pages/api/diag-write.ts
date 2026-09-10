/** 临时诊断：验证 PG boolean 列收到整数 1 / 布尔 true 的行为差异 */
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
    const out: Record<string, unknown> = {};

    // A. 传整数 1
    await client.unsafe('UPDATE articles SET encrypted = $1 WHERE slug = $2', [1, slug]);
    out.int1 = (await client.unsafe('SELECT encrypted FROM articles WHERE slug = $1', [slug]))[0];

    // B. 传布尔 true
    await client.unsafe('UPDATE articles SET encrypted = $1 WHERE slug = $2', [true, slug]);
    out.boolTrue = (await client.unsafe('SELECT encrypted FROM articles WHERE slug = $1', [slug]))[0];

    // C. 传整数 0
    await client.unsafe('UPDATE articles SET encrypted = $1 WHERE slug = $2', [0, slug]);
    out.int0 = (await client.unsafe('SELECT encrypted FROM articles WHERE slug = $1', [slug]))[0];

    // 复位
    await client.unsafe('UPDATE articles SET encrypted = false WHERE slug = $1', [slug]);
    return json({ ok: true, out });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await client.end({ timeout: 5 });
  }
};
