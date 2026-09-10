/**
 * POST /api/unlock-article —— 校验文章访问密码并签发解锁 Cookie
 *
 * ## 流程
 *
 * 1. 访客在门禁表单输入密码 → 提交到本接口；
 * 2. 服务端取出该文的密码哈希，做 PBKDF2 + timingSafe 比对；
 * 3. 通过 → 用 `signPayload` 签发含 `{ aid, exp }` 的令牌写入 HttpOnly Cookie；
 * 4. 前端 reload 页面，服务端此次检测到有效 Cookie → 正常渲染正文。
 *
 * ## 安全要点（勿回退）
 *
 * - **服务端比对**：密码不参与任何客户端解密，避免"前端藏正文"的假保护；
 * - 解锁令牌**按文章 id 隔离**（Cookie 名与载荷双重绑定），A 文解锁不能读 B 文；
 * - 令牌用 AUTH_SECRET 做 HMAC，访客无法伪造；
 * - 失败一律返回同一个模糊错误（不区分"文章不存在"与"密码错误"），避免枚举探测。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getArticlePasswordMeta } from '@/lib/articles';
import { verifyPassword } from '@/lib/article-password';
import { signPayload, SIGNED_TTL_PERMANENT_MS } from '@/lib/auth';
import { unlockCookieName } from '@/lib/article-password';
import { isProd } from '@/lib/env';

export const prerender = false;

/** 单 IP 简易节流，抵御暴力猜测密码 */
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX = 20;
const hits = new Map<string, number[]>();

function throttled(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t > THROTTLE_WINDOW_MS)) hits.delete(k);
      if (hits.size <= 2500) break;
    }
  }
  return arr.length > THROTTLE_MAX;
}

/** 统一的失败响应（不泄露文章是否存在） */
function denied(status = 401): Response {
  return json({ error: '密码错误' }, status);
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  if (throttled(clientAddress ?? 'unknown')) {
    return json({ error: '尝试过于频繁，请稍后再试' }, 429);
  }

  let body: { id?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; password?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!id || !password) return denied();

  const meta = await getArticlePasswordMeta(id);
  if (!meta || !meta.encrypted || !meta.passwordMeta) return denied();

  if (!verifyPassword(password, meta.passwordMeta)) return denied();

  // 签发解锁令牌（永久有效，直到站主重设密码或访客清 Cookie）
  const token = signPayload({ aid: meta.id, exp: Date.now() + SIGNED_TTL_PERMANENT_MS });
  cookies.set(unlockCookieName(meta.id), token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: Math.floor(SIGNED_TTL_PERMANENT_MS / 1000),
    path: '/',
  });

  return json({ ok: true });
};
