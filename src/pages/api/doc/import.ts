import type { APIRoute } from 'astro';
import { canManage } from '@/lib/admin-auth';
import { json } from '@/lib/api';
import { createDocNode, getBundle, getDocNode, nextDocNodeSort } from '@/lib/docs';
import { MarkdownImportError, readMarkdownFile } from '@/lib/markdown-file-import';

export const prerender = false;
const reply = (data: unknown, status = 200): Response => json(data, { status, headers: { 'cache-control': 'private, no-store' } });

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!await canManage(cookies, 'docs')) return reply({ error: '无文档管理权限' }, 403);
  const bundleId = url.searchParams.get('bundleId') ?? '';
  const parentId = url.searchParams.get('parentId') || null;
  if (!bundleId) return reply({ error: '请选择目标文档' }, 400);
  if (!await getBundle(bundleId)) return reply({ error: '目标文档不存在' }, 404);
  if (parentId) {
    const folder = await getDocNode(parentId);
    if (!folder || folder.kind !== 'folder' || folder.bundleId !== bundleId) return reply({ error: '目标目录不存在或不属于当前文档' }, 400);
  }
  let file: Awaited<ReturnType<typeof readMarkdownFile>>;
  try { file = await readMarkdownFile(request, url); }
  catch (error) {
    return reply({ error: error instanceof MarkdownImportError ? error.message : '读取文件失败，请重试' }, error instanceof MarkdownImportError ? error.status : 400);
  }
  const { id, title, content } = file;
  const metadata = (node: Awaited<ReturnType<typeof createDocNode>>) => {
    const { content: _content, ...meta } = node;
    return meta;
  };
  const existing = await getDocNode(id);
  const matches = (node: NonNullable<typeof existing>) => node.bundleId === bundleId && node.parentId === parentId && node.kind === 'article' && node.title === title && node.content === content;
  if (existing) return matches(existing) ? reply({ node: metadata(existing), reused: true }) : reply({ error: '导入标识对应的文章已变化，请重新拖入文件' }, 409);
  try {
    const sort = await nextDocNodeSort(bundleId, parentId);
    const node = await createDocNode({ id, bundleId, parentId, kind: 'article', title, content, sort });
    return reply({ node: metadata(node) }, 201);
  } catch (error) {
    // Two retries may race; a successful write under this ID is still one import.
    const saved = await getDocNode(id);
    if (saved && matches(saved)) return reply({ node: metadata(saved), reused: true });
    console.error('[api/doc/import]', error);
    return reply({ error: '导入失败，请重试' }, 500);
  }
};
