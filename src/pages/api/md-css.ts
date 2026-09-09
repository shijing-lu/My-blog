/**
 * GET/PUT/DELETE /api/md-css —— 自定义 Markdown 样式（管理员）
 *
 * - GET：读取当前 CSS（原文）+ updatedAt + hasCustom；
 * - PUT：保存 CSS 文本（净化 </style>、截断 64KB；空串视为清除）；
 * - DELETE：清除自定义样式（恢复站点默认）。
 *
 * 生效路径：BaseLayout 每页 SSR 注入 scopeMdCss 后的 <style>，覆盖全站 .prose；
 * 游客侧受 middleware HTML 缓存影响最多延迟 ~60s。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';
import {
  MAX_MD_CSS_CHARS,
  clearCustomMdCss,
  getCustomMdCss,
  saveCustomMdCss,
} from '@/lib/md-css';

export const prerender = false;

/** GET：读取当前自定义样式 */
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  try {
    const { css, updatedAt } = await getCustomMdCss();
    return json({ css, updatedAt, hasCustom: css.trim() !== '' });
  } catch (err) {
    console.error('[api/md-css] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** PUT：保存 CSS 文本（{css: string}；空串 = 清除） */
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  let body: { css?: unknown };
  try {
    body = (await request.json()) as { css?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  if (typeof body?.css !== 'string') {
    return json({ error: 'css 必须为字符串' }, 400);
  }
  if (body.css.length > MAX_MD_CSS_CHARS) {
    return json({ error: `CSS 过长（上限 ${Math.floor(MAX_MD_CSS_CHARS / 1024)}KB）` }, 400);
  }
  try {
    const saved = await saveCustomMdCss(body.css);
    return json({ ok: true, updatedAt: saved.updatedAt, hasCustom: saved.css.trim() !== '' });
  } catch (err) {
    console.error('[api/md-css] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};

/** DELETE：清除自定义样式（恢复默认） */
export const DELETE: APIRoute = async ({ cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  try {
    await clearCustomMdCss();
    return json({ ok: true, hasCustom: false });
  } catch (err) {
    console.error('[api/md-css] DELETE', err);
    return json({ error: '清除失败' }, 500);
  }
};
