/**
 * GET /api/export/doc/[id] —— 导出单篇文档文章（doc_nodes 节点）的 Markdown 源文
 *
 * id 为节点 id（即详情页 `?article=` 参数）。目录节点（kind=folder）与
 * 不存在的节点返回 404。doc 节点无加密门禁；正文仍属私密性低的公开内容，
 * 但为避免导出件被 CDN 缓存陈旧版本，统一 no-store。
 */
import type { APIRoute } from 'astro';
import { notFound } from '@/lib/api';
import { getDocNode } from '@/lib/docs';
import { buildMarkdownExport } from '@/lib/export';
import { serverEnv } from '@/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const node = params.id ? await getDocNode(params.id) : null;
  if (!node || node.kind !== 'article') return notFound('文档文章不存在');

  const { body, headers } = buildMarkdownExport({
    meta: {
      title: node.title,
      extra: { nodeId: node.id, bundleId: node.bundleId, kind: 'doc' },
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    },
    source: node.content ?? '',
    origin: serverEnv('PUBLIC_SITE_URL') || url.origin,
  });
  return new Response(body, { status: 200, headers });
};
