/**
 * 授权管理员权限体系
 *
 * 身份模型（三层）：
 * 1. 站主（顶级管理员）：
 *    - top_admin_session Cookie（站主密码登录，TOP_ADMIN_PASSWORD）；
 *    - 或现有 admin_session（ADMIN_PASSWORD 口令 / GitHub 白名单）——持有人即站主，视为顶级；
 *    - 站主拥有全部权限，且是唯一可进入 /admin/auth 授权管理页的身份来源之一。
 * 2. GitHub 授权管理员：user_session → admin_accounts 表命中
 *    - role='top'：顶级管理员（由站主设置的其他顶级管理员），全权限；
 *    - role='admin'：普通管理员，按 permissions 逐项授权（与站主可管理面一一对应）。
 *    - 权限判定实时查库：顶级管理员改权限后立即生效，无需换会话。
 * 3. 访客：仅 user_session（GitHub 登录）或匿名，可提交管理员权限申请。
 *
 * <!-- 区域划分 -->
 * - 权限枚举与规整：PERMISSION_KEYS / PERMISSION_LABELS / normalizePermissions
 * - 站主会话：checkTopPassword / sign·verify·set·clear TopSession
 * - 身份判定：getAdminIdentity / isTopAdmin / canManage（含时机说明）
 * - 账号 CRUD：list/create/update/deleteAdminAccount
 * - 申请 CRUD：upsertApplication / listApplications / setApplicationStatus（同意即建号）
 * - GitHub 资料同步：syncGitHubProfile（拉取 GitHub 公开资料写入 site_profile）
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { adminAccounts, adminApplications, githubUsers } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import { serverEnv, isProd } from './env';
import { saveProfile } from './profile';
import {
  signPayload,
  verifySignedPayload,
  verifyRequest,
  getCurrentUserId,
  isAllowedGitHubLogin,
  SESSION_TTL_MS,
} from './auth';
import type { AdminAccount, AdminApplication, AdminApplicationStatus, AdminRole } from '../../db/types';

/* ---------------- 权限枚举（与站主此前可管理面一一对应） ---------------- */

/** 逐项权限键 → 中文说明（授权管理页 checkbox 与提示共用） */
export const PERMISSION_KEYS = {
  articles: '文章与写作',
  moments: '动态',
  photos: '影集',
  calendar: '日历（待办/日记/日期）',
  study: '学习模式',
  docs: '文档系统',
  nav: '网址导航',
  comments: '评论管理',
  profile: '个人中心',
  settings: '站点设置',
} as const;

export type PermissionKey = keyof typeof PERMISSION_KEYS;

const ALL_KEYS = Object.keys(PERMISSION_KEYS) as PermissionKey[];

/** 权限入参规整（纯函数，可单测）：仅保留白名单键、去重 */
export function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === 'string' && (ALL_KEYS as string[]).includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** 审批通过时的默认授权（空集：由顶级管理员按需逐项勾选） */
export const DEFAULT_ADMIN_PERMISSIONS: string[] = [];

/* ---------------- 站主会话（顶级管理员） ---------------- */

/** 顶级管理员会话 Cookie 名 */
export const TOP_ADMIN_SESSION_COOKIE = 'top_admin_session';

/** 站主密码：优先环境变量 TOP_ADMIN_PASSWORD，未配置回落到内置站主密码 */
export function topAdminPassword(): string {
  return serverEnv('TOP_ADMIN_PASSWORD') || '2640477581a';
}

/** 站主密码比对（timing-safe，与 auth.checkPassword 同模式） */
export function checkTopPassword(input: string): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(topAdminPassword()).digest();
  return timingSafeEqual(a, b);
}

/** 签发顶级管理员会话令牌（复用 auth 的 HMAC 签名链路） */
export function signTopSession(): string {
  return signPayload({ role: 'top', exp: Date.now() + SESSION_TTL_MS });
}

/** 校验顶级管理员会话令牌 */
export function verifyTopSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  if (!verifySignedPayload(token)) return false;
  try {
    const [payload] = token.split('.');
    if (!payload) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown };
    return data.role === 'top';
  } catch {
    return false;
  }
}

/** 设置顶级管理员会话 Cookie */
export function setTopSessionCookie(cookies: AstroCookies): void {
  cookies.set(TOP_ADMIN_SESSION_COOKIE, signTopSession(), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: '/',
  });
}

/** 清除顶级管理员会话 Cookie */
export function clearTopSessionCookie(cookies: AstroCookies): void {
  cookies.delete(TOP_ADMIN_SESSION_COOKIE, { path: '/' });
}

/* ---------------- 身份判定 ---------------- */

/** 当前请求的管理员身份 */
export type AdminIdentity =
  | { kind: 'top' }
  | { kind: 'github'; account: AdminAccount }
  | { kind: 'visitor'; githubId: number }
  | { kind: 'anonymous' };

/**
 * 判定当前请求身份（可能触发一次 DB 查询：GitHub 登录者查授权表）。
 * 判定顺序：站主会话 → GitHub 白名单（站主本尊）→ GitHub 授权账号 → GitHub 访客 → 匿名。
 */
export async function getAdminIdentity(cookies: AstroCookies): Promise<AdminIdentity> {
  // 站主：顶级会话，或现有管理员会话（口令 / GitHub 白名单登录，持有人即站主）
  if (verifyTopSessionToken(cookies.get(TOP_ADMIN_SESSION_COOKIE)?.value) || verifyRequest(cookies)) {
    return { kind: 'top' };
  }
  const uid = getCurrentUserId(cookies);
  if (!uid) return { kind: 'anonymous' };
  const rows = await db.select().from(githubUsers).where(eq(githubUsers.id, uid)).limit(1);
  const gh = rows[0];
  if (!gh) return { kind: 'anonymous' };
  // 站主通过评论区链路（user_session）登录 GitHub 且账号命中 ADMIN_GITHUB_LOGIN
  // 白名单时，同样视为顶级管理员——不能因为走的是用户登录链路就降级为访客。
  if (isAllowedGitHubLogin(gh.login)) return { kind: 'top' };
  const accRows = await db.select().from(adminAccounts).where(eq(adminAccounts.githubId, gh.githubId)).limit(1);
  const acc = accRows[0];
  if (!acc) return { kind: 'visitor', githubId: gh.githubId };
  return {
    kind: 'github',
    account: {
      ...acc,
      role: acc.role === 'top' ? 'top' : 'admin',
      permissions: normalizePermissions(safeParse(acc.permissions)),
    },
  };
}

/** 简易 JSON 解析（脏值回落 []） */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** 是否顶级管理员（站主或 role=top 的 GitHub 管理员） */
export async function isTopAdmin(cookies: AstroCookies): Promise<boolean> {
  const identity = await getAdminIdentity(cookies);
  return identity.kind === 'top' || (identity.kind === 'github' && identity.account.role === 'top');
}

/** 是否具备某项管理权限（顶级管理员恒真；普通管理员按逐项授权） */
export async function canManage(cookies: AstroCookies, perm: PermissionKey): Promise<boolean> {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind === 'top') return true;
  if (identity.kind === 'github') {
    return identity.account.role === 'top' || identity.account.permissions.includes(perm);
  }
  return false;
}

/**
 * 是否具备给定权限键中的任意一项（middleware 用：单次身份判定，
 * 避免逐键调用 canManage 重复查库）。
 */
export async function hasAnyPermission(cookies: AstroCookies, perms: PermissionKey[]): Promise<boolean> {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind === 'top') return true;
  if (identity.kind === 'github') {
    if (identity.account.role === 'top') return true;
    return perms.some((p) => identity.account.permissions.includes(p));
  }
  return false;
}

/**
 * 站主会话快速判定（同步，不查库）：admin_session（口令/GitHub 白名单）
 * 或 top_admin_session（站主密码）任一有效即站主。
 */
export function isOwnerSession(cookies: AstroCookies): boolean {
  return verifyRequest(cookies) || verifyTopSessionToken(cookies.get(TOP_ADMIN_SESSION_COOKIE)?.value);
}

/**
 * 请求级「任意管理者」判定（API 内层纵深防御 / 后台 UI 门控）：
 * 站主两通道（同步短路）或 GitHub 授权管理员（user_session → admin_accounts，查库）。
 *
 * 背景（勿回退）：middleware 已按逐项权限把关受保护路由，但部分 API 的内层
 * 与后台布局仍保留第二道校验——这些位置历史上用 auth.verifyRequest（只认旧
 * admin_session 通道），导致新身份（站主密码 top_admin_session / GitHub
 * user_session）被误判为未登录。统一改用本函数。
 */
export async function isManagerSession(cookies: AstroCookies): Promise<boolean> {
  if (isOwnerSession(cookies)) return true;
  const identity = await getAdminIdentity(cookies);
  return identity.kind === 'github';
}

/**
 * 一次身份判定，返回逐项权限判定函数（页面/组件需按多个权限键分支 UI 时用，
 * 避免每键重复查库）。顶级管理员恒真；匿名/访客恒假。
 */
export async function permissionChecker(
  cookies: AstroCookies,
): Promise<(perm: PermissionKey) => boolean> {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind === 'top') return () => true;
  if (identity.kind === 'github') {
    const { role, permissions } = identity.account;
    return (perm) => role === 'top' || permissions.includes(perm);
  }
  return () => false;
}

/* ---------------- 账号 CRUD ---------------- */

/** 行 → 实体（permissions/role 规整） */
function mapAccount(row: typeof adminAccounts.$inferSelect): AdminAccount {
  return {
    ...row,
    role: row.role === 'top' ? 'top' : 'admin',
    permissions: normalizePermissions(safeParse(row.permissions)),
  };
}

/** 列出全部授权管理员（授权管理页） */
export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const rows = await db.select().from(adminAccounts);
  return rows.map(mapAccount);
}

/** 按 GitHub 用户 ID 查授权账号（权限判定辅助，可单测引用） */
export async function getAdminAccountByGithubId(githubId: number): Promise<AdminAccount | null> {
  const rows = await db.select().from(adminAccounts).where(eq(adminAccounts.githubId, githubId)).limit(1);
  return rows[0] ? mapAccount(rows[0]) : null;
}

/** 创建授权账号（审批同意 / 手动添加） */
export async function createAdminAccount(input: {
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
  role?: AdminRole;
  permissions?: string[];
}): Promise<AdminAccount> {
  const now = new Date();
  const rows = await dbWrite((d) =>
    d
      .insert(adminAccounts)
      .values({
        id: randomUUID(),
        githubId: input.githubId,
        login: input.login,
        name: input.name,
        avatarUrl: input.avatarUrl,
        role: input.role ?? 'admin',
        permissions: JSON.stringify(normalizePermissions(input.permissions ?? DEFAULT_ADMIN_PERMISSIONS)),
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
  );
  return mapAccount(rows[0] as typeof adminAccounts.$inferSelect);
}

/** 更新授权账号（改权限 / 升降顶级） */
export async function updateAdminAccount(
  id: string,
  patch: { role?: AdminRole; permissions?: string[] },
): Promise<AdminAccount | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.permissions !== undefined) set.permissions = JSON.stringify(normalizePermissions(patch.permissions));
  const rows = await dbWrite((d) => d.update(adminAccounts).set(set).where(eq(adminAccounts.id, id)).returning());
  return rows[0] ? mapAccount(rows[0]) : null;
}

/** 移除授权账号（顶级管理员移除自己时由调用方拦截） */
export async function deleteAdminAccount(id: string): Promise<boolean> {
  const rows = await dbWrite((d) => d.delete(adminAccounts).where(eq(adminAccounts.id, id)).returning());
  return rows.length > 0;
}

/* ---------------- 申请 CRUD ---------------- */

/** 行 → 实体 */
function mapApplication(row: typeof adminApplications.$inferSelect): AdminApplication {
  return {
    ...row,
    status: (['pending', 'approved', 'rejected'] as const).includes(row.status as AdminApplicationStatus)
      ? (row.status as AdminApplicationStatus)
      : 'pending',
    processedAt: row.processedAt ?? null,
  };
}

/**
 * 提交/重置申请（同一 GitHub 账号仅一条记录：pending 重复提交更新留言，
 * approved/rejected 后再提交视为重新申请，重置为 pending）
 */
export async function upsertApplication(input: {
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
  note: string;
}): Promise<AdminApplication> {
  const now = new Date();
  const rows = await dbWrite((d) =>
    d
      .insert(adminApplications)
      .values({
        id: randomUUID(),
        githubId: input.githubId,
        login: input.login,
        name: input.name,
        avatarUrl: input.avatarUrl,
        note: input.note.slice(0, 200),
        status: 'pending',
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: adminApplications.githubId,
        set: {
          login: input.login,
          name: input.name,
          avatarUrl: input.avatarUrl,
          note: input.note.slice(0, 200),
          status: 'pending',
          processedAt: null,
        },
      })
      .returning(),
  );
  return mapApplication(rows[0] as typeof adminApplications.$inferSelect);
}

/** 列出申请（status 缺省=pending；'all' 返回全部） */
export async function listApplications(status?: AdminApplicationStatus | 'all'): Promise<AdminApplication[]> {
  const rows = await db.select().from(adminApplications);
  const mapped = rows.map(mapApplication);
  const filtered = !status || status === 'all' ? mapped : mapped.filter((a) => a.status === status);
  return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * 审批申请：同意 → 建授权账号（若同 GitHub 已有账号则只更新申请状态）；
 * 拒绝 → 仅更新状态。返回是否新建了账号。
 */
export async function setApplicationStatus(
  id: string,
  status: Exclude<AdminApplicationStatus, 'pending'>,
  permissions: string[] = DEFAULT_ADMIN_PERMISSIONS,
): Promise<{ application: AdminApplication | null; createdAccount: boolean }> {
  const rows = await db.select().from(adminApplications).where(eq(adminApplications.id, id)).limit(1);
  const app = rows[0];
  if (!app) return { application: null, createdAccount: false };
  const updated = await dbWrite((d) =>
    d
      .update(adminApplications)
      .set({ status, processedAt: new Date() })
      .where(eq(adminApplications.id, id))
      .returning(),
  );
  let createdAccount = false;
  if (status === 'approved') {
    const existing = await getAdminAccountByGithubId(app.githubId);
    if (!existing) {
      await createAdminAccount({
        githubId: app.githubId,
        login: app.login,
        name: app.name,
        avatarUrl: app.avatarUrl,
        role: 'admin',
        permissions,
      });
      createdAccount = true;
    }
  }
  return { application: mapApplication(updated[0] as typeof adminApplications.$inferSelect), createdAccount };
}

/* ---------------- GitHub 资料同步（个人信息设置） ---------------- */

/** 拉取 GitHub 公开资料（无 token 的公开接口，60 req/h 足够管理页低频使用） */
export async function fetchGitHubPublicProfile(
  login: string,
): Promise<{ id: number; login: string; name: string; avatarUrl: string } | null> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'my-blog' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  if (!data.login || typeof data.id !== 'number') return null;
  return { id: data.id, login: data.login, name: data.name || data.login, avatarUrl: data.avatar_url || '' };
}

/** 将指定 GitHub 账号的头像/昵称写入个人中心（site_profile），返回同步结果 */
export async function syncGitHubProfile(login: string): Promise<{ nickname: string; avatar: string } | null> {
  const gh = await fetchGitHubPublicProfile(login);
  if (!gh) return null;
  const saved = await saveProfile({ nickname: gh.name, avatar: gh.avatarUrl });
  return { nickname: saved.nickname, avatar: saved.avatar };
}
