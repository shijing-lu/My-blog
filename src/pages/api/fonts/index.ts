/**
 * GET/POST /api/fonts —— 自定义字体列表 / 上传（上传需管理员）
 *
 * GET:  → { fonts: [{id, familyName, mime, size, createdAt}] }（不含 data）
 * POST: { familyName, mime, data(base64) } → 201 { font }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { addFont, listFontsMeta } from '@/lib/fonts';

export const prerender = false;

// Vercel 函数请求体上限 4.5MB；base64 膨胀约 1/3 → 限制字体 ≤2MB（base64 ~2.7MB），留足余量
const MAX_FONT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_NAME = 100;

/** GET：列表（公开元信息） */
export const GET: APIRoute = async () => {
  try {
    const fonts = await listFontsMeta();
    return json({ fonts });
  } catch (err) {
    console.error('[api/fonts]', err);
    return json({ error: '获取字体失败' }, 500);
  }
};

/** POST：上传（管理员） */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);

  let body: { familyName?: unknown; mime?: unknown; data?: unknown };
  try {
    body = (await request.json()) as { familyName?: unknown; mime?: unknown; data?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const familyName = typeof body.familyName === 'string' ? body.familyName.trim().slice(0, MAX_NAME) : '';
  if (!familyName) return json({ error: '请填写字体名称' }, 400);
  const mime = typeof body.mime === 'string' && /^font\/[\w.+-]+$/.test(body.mime) ? body.mime : 'font/woff2';
  const dataBase64 = typeof body.data === 'string' ? body.data : '';
  if (!dataBase64) return json({ error: '缺少字体数据' }, 400);
  const byteLength = Buffer.from(dataBase64, 'base64').length;
  if (byteLength === 0) return json({ error: '字体内容为空' }, 400);
  if (byteLength > MAX_FONT_BYTES) {
    return json({ error: '字体不能超过 2MB（建议用 woff2 子集字体，如常用汉字版约几百 KB）' }, 413);
  }

  try {
    const font = await addFont({ familyName, mime, dataBase64 });
    return json({ font: { id: font.id, familyName: font.familyName, mime: font.mime, size: font.size } }, 201);
  } catch (err) {
    console.error('[api/fonts]', err);
    return json({ error: '上传失败' }, 500);
  }
};
