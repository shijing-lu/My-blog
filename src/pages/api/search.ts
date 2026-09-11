/**
 * GET /api/search —— 首页服务端搜索（公开）
 *
 * 请求：?q=<关键词>&type=<all|tech|note|photo>
 * 返回：{ articles: [{ id, title, slug, type, summary, snippet, cover, tags, updatedAt, charCount }], total }
 * - 匹配范围：标题 / 摘要 / 标签 / **正文**（正文剥离 Markdown 语法后匹配）；
 * - snippet：正文命中时返回命中处上下文片段（前端展示「为什么命中」），
 *   标题/摘要/标签命中（或无关键词）时回退为 summary；
 * - cover 已按「手动封面 > 正文首图」解析好，前端直接渲染卡片；
 * - 结果按更新时间倒序，最多返回 50 条。
 */
import type { APIRoute } from 'astro';
import { listArticleMeta, getArticleContents, resolveCover } from '@/lib/articles';
import { articleCategoryMap } from '@/lib/article-categories';
import { badRequest, json } from '@/lib/api';
import { countChars } from '@/lib/reading';
import { cardCoverUrl } from '@/lib/images';
import { isArticleType } from '../../../db/types';
import { needsContentScan, extractSnippet, matchMeta, stripMarkdownCached } from '@/lib/search';

export const prerender = false;

/** 搜索结果上限 */
const MAX_RESULTS = 50;

/**
 * 正文扫描的候选上限。
 *
 * 只有「关键词不在标题/摘要/标签里」时才需要下探正文（见 `needsContentScan`）。
 * 该路径下若文章成千上万，正文全扫仍是 O(N×正文) —— 因此设一个硬上限，
 * 只对**最近的** `MAX_CONTENT_SCAN` 篇做正文剥离匹配。
 *
 * 取舍：超出上限的老文章将无法被「正文关键词」命中（仍可被标题/摘要/标签命中）。
 * 这是刻意的成本—召回折中：搜索框随手输入不应触发全库正则风暴。
 * 后续若召回不可接受，应改上 FTS / `content_text` 冗余列（见报告 P0-2 备选方案）。
 */
const MAX_CONTENT_SCAN = 300;

/**
 * GET 处理器
 *
 * ## 两阶段检索（P0-2 修复）
 *
 * 旧实现：`listArticles()` 取**全表含正文** → 对**每一篇**做 `stripMarkdown`
 * （12 次正则替换）+ `toLowerCase`。500 篇 × 30KB ≈ 15MB 字符串 + 500 次正则扫描，
 * 而搜索框每次输入都可能触发。
 *
 * 现拆两阶段：
 * 1. **元信息粗筛**：只取 title/summary/tags（不含正文），先命中即返回；
 * 2. **正文细筛**（按需）：仅当存在「元信息未命中」的候选、且候选数在上限内时，
 *    才按 id 批量取回这些候选的正文 —— 且**只对未命中的那些**做剥离匹配。
 *
 * 效果：常见查询（关键词出现在标题/摘要/标签）**完全不读正文**；
 * 即便走正文路径，取的也是「数量受限的候选正文」而非全表。
 */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const type = url.searchParams.get('type') ?? 'all';
  if (type !== 'all' && !isArticleType(type)) {
    return badRequest('type 不合法');
  }
  // 自定义分类筛选（分类 id；'all'/空 = 不过滤）。表未迁移时 map 为空 → 结果为空，不报错。
  const category = url.searchParams.get('category') ?? 'all';

  /* ---- 阶段 1：元信息粗筛（不含正文）---- */
  const allMeta = await listArticleMeta();
  let catMap: Map<string, string> | null = null;
  if (category !== 'all' && category) {
    catMap = await articleCategoryMap();
  }

  /** 通过类型/分类过滤后的候选（顺序即 updatedAt 倒序） */
  const candidates = allMeta.filter((a) => {
    if (type !== 'all' && a.type !== type) return false;
    if (catMap && catMap.get(a.id) !== category) return false;
    return true;
  });

  /** 元信息已命中的 id */
  const metaHit = new Set(candidates.filter((a) => matchMeta(a, q)).map((a) => a.id));

  /* ---- 阶段 2：正文细筛（仅按需 + 仅对未命中项）---- */
  const scanTargets = q && needsContentScan(metaHit.size, candidates.length)
    ? candidates.filter((a) => !metaHit.has(a.id)).slice(0, MAX_CONTENT_SCAN)
    : [];
  const contentById = scanTargets.length > 0
    ? await getArticleContents(scanTargets.map((a) => a.id))
    : new Map<string, string>();

  const matched = candidates.filter((a) => {
    if (metaHit.has(a.id)) return true;
    const content = contentById.get(a.id);
    if (content === undefined) return false;
    // 空关键词时 matchMeta 已全命中，不会走到这里
    return stripMarkdownCached(content).includes(q);
  });

  const articles = matched.slice(0, MAX_RESULTS).map((a) => {
    // 加密文章 content 落库为空串 → 天然不会「正文命中」；snippet 回退为摘要。
    // 前端据 encrypted 显示锁标识并提示需解锁。
    const content = contentById.get(a.id);
    const snippet = a.encrypted
      ? a.summary
      : (content !== undefined ? (extractSnippet(content, q) ?? a.summary) : a.summary);
    return {
      id: a.id,
      title: a.title,
      slug: a.slug,
      type: a.type,
      summary: a.summary,
      snippet,
      cover: cardCoverUrl(resolveCover({ cover: a.cover, content: content ?? '' })),
      tags: a.tags,
      encrypted: a.encrypted,
      updatedAt: a.updatedAt.toISOString(),
      charCount: a.encrypted ? 0 : content !== undefined ? countChars(content) : 0,
    };
  });

  return json(
    { articles, total: matched.length, query: q, type, category },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
};
