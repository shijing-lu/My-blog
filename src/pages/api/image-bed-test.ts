/**
 * POST /api/image-bed-test —— GitHub 图床连接测试（管理员）
 *
 * 请求体（可选字段，缺省回落 DB 已存配置；token 空 = 用已存 token）：
 * { owner?, repo?, branch?, token? }
 *
 * 返回 { ok, message }：ok=true 仓库可达（附仓库可见性与默认分支）。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';
import { getImageBedConfig } from '@/lib/image-bed';
import { testGitHubConnection } from '@/lib/gh-image-bed';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  let body: { owner?: string; repo?: string; branch?: string; token?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const saved = await getImageBedConfig();
    const owner = typeof body.owner === 'string' && body.owner.trim() !== '' ? body.owner.trim() : saved.owner;
    const repo = typeof body.repo === 'string' && body.repo.trim() !== '' ? body.repo.trim() : saved.repo;
    // token：表单留空 → 用 DB 已存 token
    const token =
      typeof body.token === 'string' && body.token.trim() !== '' ? body.token.trim() : saved.token;
    const result = await testGitHubConnection(owner, repo, token);
    return json(result);
  } catch (err) {
    console.error('[api/image-bed-test]', err);
    return json({ ok: false, message: '测试失败' }, 500);
  }
};
