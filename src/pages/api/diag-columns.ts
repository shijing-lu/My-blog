/** 临时诊断：查 articles 表加密列的真实类型与样例值（仅管理员） */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';

export const prerender = false;
export const config = { maxDuration: 60 };

export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: '未登录' }, 401);
  const url = process.env.DATABASE_URL;
  if (!url) return json({ error: 'no url' }, 500);
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    const cols = await client.unsafe(
      "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='articles' AND column_name IN ('encrypted','encrypt_hint','encrypt_meta') ORDER BY column_name",
    );
    const sample = await client.unsafe(
      "SELECT id, encrypted, pg_typeof(encrypted) AS enc_type, encrypt_hint, length(encrypt_meta) AS meta_len, length(content) AS content_len FROM articles ORDER BY updated_at DESC LIMIT 5",
    );
    return json({ ok: true, columns: cols, sample });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await client.end({ timeout: 5 });
  }
};
