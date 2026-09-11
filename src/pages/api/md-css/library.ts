/**
 * GET/POST/PUT/DELETE /api/md-css/library —— Markdown 样式库（管理员）
 *
 * - GET            ：样式列表（不含 css，仅 id/name/cssLength/updatedAt，供下拉框）；
 * - GET ?id=xxx    ：单条（含 css，供选中后填入编辑框）；
 * - POST {name,css}：新增（库满/名称空 → 400）；
 * - PUT ?id=xxx    ：更新（{name?, css?} 可选字段）；
 * - DELETE ?id=xxx ：删除。
 *
 * 存储为 settings 表 `md_css_library` 键（JSON 列表），与当前生效样式（md_custom_css）解耦。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, missing, notFound, readJson } from '@/lib/api';
import {
  MAX_MD_CSS_ITEMS,
  MAX_MD_CSS_NAME_CHARS,
  addMdCssLibraryItem,
  deleteMdCssLibraryItem,
  getMdCssLibrary,
  getMdCssLibraryItem,
  updateMdCssLibraryItem,
} from '@/lib/md-css-library';
import { MAX_MD_CSS_CHARS } from '@/lib/md-css';

export const prerender = false;

/** GET：列表（默认）或单条（?id=） */
export const GET: APIRoute = async ({ cookies, url }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = url.searchParams.get('id');
  try {
    if (id) {
      const item = await getMdCssLibraryItem(id);
      if (!item) return notFound('样式不存在');
      return json({ item });
    }
    const items = await getMdCssLibrary();
    return json({
      items: items.map((it) => ({
        id: it.id,
        name: it.name,
        cssLength: it.css.length,
        updatedAt: it.updatedAt,
      })),
      max: MAX_MD_CSS_ITEMS,
    });
  } catch (err) {
    console.error('[api/md-css/library] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** POST：新增 {name, css} */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ name?: unknown; css?: unknown }>(request);
  if (!body) return badJson();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const css = typeof body?.css === 'string' ? body.css : '';
  if (name === '') return badRequest('请填写样式名称');
  if (name.length > MAX_MD_CSS_NAME_CHARS) return json({ error: `名称过长（上限 ${MAX_MD_CSS_NAME_CHARS} 字）` }, 400);
  if (css.trim() === '') return badRequest('样式内容为空');
  if (css.length > MAX_MD_CSS_CHARS) return json({ error: `CSS 过长（上限 ${Math.floor(MAX_MD_CSS_CHARS / 1024)}KB）` }, 400);
  try {
    const item = await addMdCssLibraryItem(name, css);
    return json({ ok: true, item: { id: item.id, name: item.name, cssLength: item.css.length, updatedAt: item.updatedAt } });
  } catch (err) {
    if (err instanceof Error && err.message.includes('已满')) return badRequest(err.message);
    console.error('[api/md-css/library] POST', err);
    return json({ error: '保存失败' }, 500);
  }
};

/** PUT：更新 ?id= {name?, css?} */
export const PUT: APIRoute = async ({ request, cookies, url }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = url.searchParams.get('id');
  if (!id) return missing('id');
  const body = await readJson<{ name?: unknown; css?: unknown }>(request);
  if (!body) return badJson();
  const patch: { name?: string; css?: string } = {};
  if (body?.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') return badRequest('名称不能为空');
    patch.name = body.name.trim();
  }
  if (body?.css !== undefined) {
    if (typeof body.css !== 'string') return badRequest('css 必须为字符串');
    if (body.css.length > MAX_MD_CSS_CHARS) return json({ error: `CSS 过长（上限 ${Math.floor(MAX_MD_CSS_CHARS / 1024)}KB）` }, 400);
    patch.css = body.css;
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新字段');
  try {
    const item = await updateMdCssLibraryItem(id, patch);
    if (!item) return notFound('样式不存在');
    return json({ ok: true, item: { id: item.id, name: item.name, cssLength: item.css.length, updatedAt: item.updatedAt } });
  } catch (err) {
    console.error('[api/md-css/library] PUT', err);
    return json({ error: '更新失败' }, 500);
  }
};

/** DELETE：删除 ?id= */
export const DELETE: APIRoute = async ({ cookies, url }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = url.searchParams.get('id');
  if (!id) return missing('id');
  try {
    const ok = await deleteMdCssLibraryItem(id);
    if (!ok) return notFound('样式不存在');
    return json({ ok: true });
  } catch (err) {
    console.error('[api/md-css/library] DELETE', err);
    return json({ error: '删除失败' }, 500);
  }
};
