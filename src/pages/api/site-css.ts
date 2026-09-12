/**
 * GET/PUT/DELETE /api/site-css —— 全站文字自定义样式（管理员）
 *
 * - GET：读取当前 CSS（原文）+ updatedAt + hasCustom；
 * - PUT：保存 CSS 文本（净化 </style>、截断 64KB；空串视为清除）；
 * - DELETE：清除自定义样式（回到内置默认风格包）。
 *
 * 生效路径：BaseLayout 每页 SSR 注入——
 *   ① @layer site-text 内置默认包（始终存在）；② unlayered 自定义 CSS（保存后）。
 *   游客侧受 middleware HTML 缓存影响最多延迟 ~60s。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import {
  MAX_MD_CSS_CHARS,
  clearCustomSiteCss,
  getCustomSiteCss,
  saveCustomSiteCss,
} from '@/lib/site-css';

export const prerender = false;

/** GET：读取当前自定义样式 */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    const { css, updatedAt } = await getCustomSiteCss();
    return json({ css, updatedAt, hasCustom: css.trim() !== '' });
  } catch (err) {
    console.error('[api/site-css] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** PUT：保存 CSS 文本（{css: string}；空串 = 清除） */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ css?: unknown }>(request);
  if (!body) return badJson();
  const css = typeof body.css === 'string' ? body.css : '';
  if (css.length > MAX_MD_CSS_CHARS) return badRequest(`CSS 过长（上限 ${Math.round(MAX_MD_CSS_CHARS / 1024)}KB）`);
  try {
    const saved = await saveCustomSiteCss(css);
    return json({ ok: true, css: saved.css, updatedAt: saved.updatedAt, hasCustom: saved.css.trim() !== '' });
  } catch (err) {
    console.error('[api/site-css] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};

/** DELETE：清除自定义样式（回到内置默认风格包） */
export const DELETE: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    await clearCustomSiteCss();
    return json({ ok: true });
  } catch (err) {
    console.error('[api/site-css] DELETE', err);
    return json({ error: '恢复失败' }, 500);
  }
};
