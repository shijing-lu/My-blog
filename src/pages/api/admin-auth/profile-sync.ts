/**
 * POST /api/admin-auth/profile-sync —— 个人信息同步为指定 GitHub 账号资料
 *
 * body: { login } → 拉取 GitHub 公开资料（头像/昵称）→ 写入 site_profile
 * （个人中心与博客头像联动展示处自动生效）。仅顶级管理员可用。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, forbidden, json, notFound, readJson } from '@/lib/api';
import { isTopAdmin, syncGitHubProfile } from '@/lib/admin-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies))) return forbidden();
  const body = await readJson<{ login?: unknown }>(request);
  if (!body) return badJson();
  const login = typeof body.login === 'string' ? body.login.trim().slice(0, 100) : '';
  if (!/^[A-Za-z0-9-]{1,100}$/.test(login)) {
    return badRequest('请输入合法的 GitHub 用户名');
  }
  const synced = await syncGitHubProfile(login);
  if (!synced) return notFound('GitHub 用户不存在或拉取失败');
  return json({ profile: synced });
};
