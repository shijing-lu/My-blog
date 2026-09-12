/**
 * POST /api/views —— 文章阅读上报（公开，无需登录）
 *
 * body: { articleId }
 * 返回: { ok: true }
 *
 * ## 为什么不做身份校验 / 去重
 *
 * 阅读量口径被明确设定为「**每次访问 +1**」（见 `article_views` 表与
 * `src/lib/article-views.ts` 注释）。没有身份维度，也就不需要指纹或登录态，
 * 端点保持极简：校验 → 写一行流水。
 *
 * ## 为什么加限流
 *
 * 端点匿名可写，若不设闸，一个循环脚本就能把表写爆。
 * 用项目既有的内存限流（`rate-limit.ts`）做粗粒度防护：按来源 IP + 文章 id
 * 组合计数，阈值放得较宽（同一人正常阅读/回退再进不会被误伤），
 * 只拦明显的脚本刷量。超限时**返回 200 + { ok: false }** 而非 429 ——
 * 埋点失败不该在访客控制台留下刺眼报错，静默丢弃即可。
 *
 * ## 只允许 POST
 *
 * 刻意不提供 GET：GET 会被浏览器预取、爬虫与链接预览触发，污染计数。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, serverError } from '@/lib/api';
import { recordView } from '@/lib/article-views';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

/** articleId 长度上限（UUID 36 字符，留足余量） */
const MAX_LEN = 200;

/** 限流阈值：同一 IP 对同一文章，10 分钟内最多计 60 次 */
const LIMIT = 60;
const WINDOW_MS = 10 * 60 * 1000;

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request);
  if (body === null) return badJson();
  if (body === '') return badRequest('缺少文章 ID');

  const articleId = body;
  // 限流：超限静默丢弃（返回 ok:false 而非 4xx，避免埋点报错打扰访客）
  const gate = rateLimit(`views:${clientKey(request)}:${articleId}`, LIMIT, WINDOW_MS);
  if (!gate.ok) return json({ ok: false });

  try {
    await recordView(articleId);
    return json({ ok: true });
  } catch (err) {
    return serverError('views', err, '记录失败');
  }
};

/** 解析并校验请求体：返回合法 articleId；`null` = JSON 非法；`''` = 缺字段 */
async function readBody(request: Request): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = (parsed as { articleId?: unknown }).articleId;
  const articleId = typeof raw === 'string' ? raw.trim() : '';
  if (!articleId || articleId.length > MAX_LEN) return '';
  return articleId;
}
