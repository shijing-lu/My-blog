/**
 * GET/POST /api/fonts —— 自定义字体列表 / 上传（上传需管理员）
 *
 * GET:  → { fonts: [{id, familyName, mime, size, createdAt}] }（不含 data）
 * POST: { familyName, mime, data(base64) } → 201 { font }
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, jsonCached, readJson } from '@/lib/api';
import { addFont, listFontsMeta } from '@/lib/fonts';

export const prerender = false;

// Vercel 函数请求体上限 4.5MB；base64 膨胀约 1/3 → 最大可安全接受 ~3.3MB，取 3MB 留余量
const MAX_FONT_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_NAME = 100;

/** GET：列表（公开元信息） */
export const GET: APIRoute = async () => {
  try {
    // P3-5：公开、与登录态无关、极少变动 → 走 CDN 短缓存（判定规则见 jsonCached 注释）
    // 注意：上传/删除字体后列表最多陈旧 30s，属可接受范围；错误路径仍用 json() 不缓存。
    const fonts = await listFontsMeta();
    return jsonCached({ fonts });
  } catch (err) {
    console.error('[api/fonts]', err);
    return json({ error: '获取字体失败' }, 500);
  }
};

/** POST：上传（管理员） */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ familyName?: unknown; mime?: unknown; data?: unknown }>(request);
  if (!body) return badJson();
  const familyName = typeof body.familyName === 'string' ? body.familyName.trim().slice(0, MAX_NAME) : '';
  if (!familyName) return badRequest('请填写字体名称');
  const mime = typeof body.mime === 'string' && /^font\/[\w.+-]+$/.test(body.mime) ? body.mime : 'font/woff2';
  const dataBase64 = typeof body.data === 'string' ? body.data : '';
  if (!dataBase64) return badRequest('缺少字体数据');
  const byteLength = Buffer.from(dataBase64, 'base64').length;
  if (byteLength === 0) return badRequest('字体内容为空');
  if (byteLength > MAX_FONT_BYTES) {
    return json({ error: '字体不能超过 3MB（Vercel 函数请求体硬上限 4.5MB；更大字体请用子集化 scripts/subset-font.mjs）' }, 413);
  }

  try {
    const font = await addFont({ familyName, mime, dataBase64 });
    return json({ font: { id: font.id, familyName: font.familyName, mime: font.mime, size: font.size } }, 201);
  } catch (err) {
    console.error('[api/fonts]', err);
    return json({ error: '上传失败' }, 500);
  }
};
