/**
 * GET/PUT /api/editor-shortcuts —— Markdown 编辑器快捷键（自定义绑定）
 *
 * - GET：读取（公开：编辑器组件需要；仅含当前用户自己的自定义，不含敏感信息）
 * - PUT：保存（管理员，中间件保护）
 *   body: { custom: { "<命令id>": "<CodeMirror 绑定串>" } }
 * - 校验：仅接受已知命令 id；绑定串规范化（Mod/Alt/Shift + 键名）；未知/非法项忽略
 */
import type { APIRoute } from 'astro';
import { badJson, json, readJson } from '@/lib/api';
import { getCustomBindings, resolveBindings, saveCustomBindings } from '@/lib/editor-shortcuts';

export const prerender = false;

/** GET：读取（默认 + 自定义合并后的最终绑定，附带冲突列表） */
export const GET: APIRoute = async () => {
  const custom = await getCustomBindings();
  const { bindings, conflicts } = resolveBindings(custom);
  return json({ custom, bindings, conflicts });
};

/** PUT：保存自定义绑定 */
export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badJson();
  }
  if (!body.custom || typeof body.custom !== 'object' || Array.isArray(body.custom)) {
    return json({ error: '缺少 custom 字段' }, 400);
  }
  try {
    const custom = await saveCustomBindings(body.custom);
    const { bindings, conflicts } = resolveBindings(custom);
    return json({ custom, bindings, conflicts });
  } catch (err) {
    console.error('[api/editor-shortcuts]', err);
    return json({ error: '保存失败' }, 500);
  }
};
