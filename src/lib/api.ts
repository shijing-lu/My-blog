/**
 * API 通用工具：JSON 响应、错误响应标准化、请求体解析、权限守卫与文章序列化
 */
import type { AstroCookies } from 'astro';
import type { Article } from '../../db/types';

/** 构造 JSON 响应（兼容 status 数字或 ResponseInit 两种用法） */
export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const status = typeof init === 'number' ? init : (init.status ?? 200);
  const headers = new Headers(typeof init === 'object' ? init.headers : undefined);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

/* ===== 错误响应标准化（P1-10）=====
 * 端点里 `return json({ error: 'xxx' }, 400)` 这类写法出现 200+ 次，
 * 其中仅「请求格式错误」就重复 60+ 次、「缺少 id」20+ 次。语义完全一致，
 * 但状态码与文案散落各处，改一处文案要全仓搜索替换，也容易写错状态码。
 * 这里按状态码收敛为具名函数：调用点变成 `return apiError.badRequest()`，
 * 语义自解释、文案单点维护、状态码不会写错。 */

/** 统一错误响应体形状：`{ error: string }` */
export interface ApiErrorBody {
  error: string;
}

/** 400 请求体不是合法 JSON（所有 `try { await request.json() } catch` 的统一出口） */
export function badJson(message = '请求格式错误'): Response {
  return json({ error: message }, 400);
}

/** 400 参数校验失败（缺字段 / 取值非法） */
export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

/** 400 必填字段缺失：文案统一为「缺少 <字段名>」，避免同义写法漂移 */
export function missing(field: string): Response {
  return json({ error: `缺少 ${field}` }, 400);
}

/** 401 未登录或凭证失效 */
export function unauthorized(message = '请先登录'): Response {
  return json({ error: message }, 401);
}

/** 403 已登录但无权限 */
export function forbidden(message = '无权操作'): Response {
  return json({ error: message }, 403);
}

/** 404 资源不存在 */
export function notFound(message = '资源不存在'): Response {
  return json({ error: message }, 404);
}

/** 429 触发限流；`retryAfterSec` 同时写入 `Retry-After` 头，供客户端安排重试 */
export function tooMany(message: string, retryAfterSec: number): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfterSec))));
  return new Response(JSON.stringify({ error: message }), { status: 429, headers });
}

/** 500 服务端异常；`err` 会打日志（便于线上排查），但**不会**泄露给客户端 */
export function serverError(scope: string, err: unknown, message = '服务器内部错误'): Response {
  console.error(`[api/${scope}]`, err);
  return json({ error: message }, 500);
}

/** 统一解析 JSON 请求体：非法 JSON 返回 null（调用方 `if (!body) return badJson();`）。
 *  比每个端点写一遍 `let body; try { body = await request.json() } catch { ... }` 更短，
 *  且泛型约束让字段类型标注只写一次。 */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const parsed: unknown = await request.json();
    // 顶层必须是对象：`[]` / `"str"` / `123` 对端点无意义，按格式错误处理
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * 宽松解析 JSON 请求体：**允许空 body / 非法 JSON**，一律返回 `{}`。
 * 用于「参数可选、不传就用已有配置」的端点（如 AI 连通性测试、图床测试）——
 * 这类请求体经常干脆不发送，报 400 反而妨碍用户。
 * 与 `readJson` 的差别：`readJson` 严格（失败给 null 让调用方报错），本函数永不失败。
 */
export async function readJsonLoose<T extends object = Record<string, unknown>>(
  request: Request,
): Promise<Partial<T>> {
  const parsed = await readJson<Partial<T>>(request);
  return parsed ?? {};
}

/**
 * 公开 GET 数据的 CDN 缓存响应（短 TTL + stale-while-revalidate）。
 * 由 Vercel 边缘（及前置 Cloudflare）缓存，显著降低源站/数据库请求量。
 *
 * ===== 使用判定 checklist（P3-5）=====
 * 必须**同时**满足下面 4 条才用 `jsonCached`，否则一律用 `json()`：
 * 1. 响应内容与登录态无关（同一 URL 任何人拿到同一份结果）；
 *    ⚠️ 只要响应里掺了「按权限裁剪」的字段（如私密待办/日记、管理按钮），就不能缓存——
 *       否则缓存会把 A 的私密数据发给 B。
 * 2. 是读接口（GET），且不需要"写完立刻读到最新"（管理台增删改后通常立即重拉列表 → 不缓存）；
 * 3. 允许数十秒的陈旧（`s-maxage` 默认 30s + `stale-while-revalidate` 300s）；
 * 4. 出错路径同样安全（5xx 不应被 CDN 长时间缓存，故错误响应仍走 `json()`）。
 *
 * 现状速查（已按上述规则处理过的公开读接口）：
 * - 用 jsonCached：landing / background / quote-settings / profile / moments(列表) /
 *   photos(列表) / calendar-events / doc(树) / doc/search / doc/nodes/[id]/render /
 *   fonts(列表) / nav(列表)
 * - 故意不缓存：article-categories（管理台读写同一列表，显式 no-store）、
 *   calendar-month（按 calendar 权限裁剪私密待办/日记）、comments / diary / todos /
 *   mindmaps / md-css / admin-auth/*（登录态或私密数据）、fonts/[id]（二进制，
 *   自带 immutable 长缓存，不走 JSON）。
 */
export function jsonCached(data: unknown, sMaxAge = 30, swr = 300): Response {
  return json(data, {
    headers: {
      'cache-control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
    },
  });
}

/* ===== 权限守卫（P1-10）=====
 * 端点开头那行
 *   if (!(await isManagerSession(cookies))) return unauthorized('unauthorized');
 * 出现 38 次（34 次文案 'unauthorized'、4 次 '未登录'）——同一语义两种英文/中文文案，
 * 且读起来别扭（先取反再返回）。改为返回 `Response | null` 的守卫：
 *   const denied = await guardManager(cookies);
 *   if (denied) return denied;
 * 语义直白、文案单点维护（'未登录'），也不再把 'unauthorized' 这种英文串暴露给用户。 */

/**
 * 管理端守卫：有 manager 会话（站主或已授权管理员）→ null；否则 → 401 响应。
 * 调用方：`const denied = await guardManager(cookies); if (denied) return denied;`
 */
export async function guardManager(cookies: AstroCookies): Promise<Response | null> {
  const { isManagerSession } = await import('./admin-auth');
  return (await isManagerSession(cookies)) ? null : unauthorized('未登录');
}

/**
 * 顶级管理员守卫：仅站主 / role=top → null；否则 → 403 响应。
 * 注意与 guardManager 的差别：这里是「已登录但权限不足」的 403，
 * 未登录同样落到 403（避免向未登录者暴露「你该去登录哪个页面」）。
 */
export async function guardTopAdmin(cookies: AstroCookies): Promise<Response | null> {
  const { isTopAdmin } = await import('./admin-auth');
  return (await isTopAdmin(cookies)) ? null : forbidden();
}

/** 文章实体 → 可序列化对象（Date → ISO 字符串） */
export function serializeArticle(article: Article): {
  id: string;
  title: string;
  slug: string;
  content: string;
  type: Article['type'];
  summary: string;
  cover: string | null;
  tags: string[];
  encrypted: boolean;
  encryptHint: string;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    content: article.content,
    type: article.type,
    summary: article.summary,
    cover: article.cover,
    tags: article.tags,
    encrypted: article.encrypted,
    encryptHint: article.encryptHint,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}
