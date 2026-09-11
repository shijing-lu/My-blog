/**
 * 站内搜索工具（纯函数，可单测）
 *
 * - matchArticle：标题 / 摘要 / 标签 / 正文 任一命中即匹配
 * - extractSnippet：正文命中时抽取命中处上下文片段（先剥离 Markdown 语法噪声）
 */

/** 剥离 Markdown 语法噪声，得到近似纯文本（代码块/图片/链接/标记符） */
export function stripMarkdown(source: string): string {
  return source
    // 围栏代码块整体移除（避免关键字命中代码段造成「正文匹配」错觉）——保留语言行以支持命中代码主题
    .replace(/```[\s\S]*?```/g, ' ')
    // 行内代码
    .replace(/`([^`]*)`/g, '$1')
    // 图片 ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 链接 [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // HTML 标签
    .replace(/<[^>]+>/g, ' ')
    // 标题 / 引用 / 列表 / 强调 标记符
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, '')
    // 多余空白收敛
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 抽取正文命中片段：返回 q 首次出现位置附近（前后各 radius 字符）的纯文本。
 * 未命中返回 null。大小写不敏感；返回文本已转为小写以便与查询一致展示。
 */
export function extractSnippet(source: string, q: string, radius = 60): string | null {
  const query = q.trim().toLowerCase();
  if (!query) return null;
  const text = stripMarkdown(source).toLowerCase();
  const idx = text.indexOf(query);
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const raw = text.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${raw}${end < text.length ? '…' : ''}`;
}

/**
 * 元信息匹配：标题 / 摘要 / 标签 任一包含关键词。
 *
 * 这是搜索的**第一阶段**（廉价）：只读元信息，不碰正文。
 * 命中即可直接返回，无需剥离 Markdown、无需取正文。
 *
 * @param a 文章元信息（不含正文）
 * @param q 关键词（内部统一转小写）
 * @returns 是否命中
 */
export function matchMeta(
  a: { title: string; summary: string; tags: string[] },
  q: string,
): boolean {
  const query = q.trim().toLowerCase();
  // 空关键词 = 不过滤（调用方据此认为「全部命中」）
  if (!query) return true;
  return (
    a.title.toLowerCase().includes(query) ||
    a.summary.toLowerCase().includes(query) ||
    a.tags.some((t) => t.toLowerCase().includes(query))
  );
}

/**
 * 是否需要下探正文扫描。
 *
 * 仅在「有候选、有关键词、且并非全部候选都已被元信息命中」时才需要 ——
 * 若 `metaHitCount === candidateCount`，说明结果集已由元信息完全确定，
 * 再扫正文纯属浪费（这正是旧实现的最大浪费点）。
 *
 * @param metaHitCount 元信息已命中数
 * @param candidateCount 类型/分类过滤后的候选总数
 * @returns 是否需要读取并扫描正文
 */
export function needsContentScan(metaHitCount: number, candidateCount: number): boolean {
  return candidateCount > 0 && metaHitCount < candidateCount;
}

/** 剥离 Markdown 缓存（按原文串缓存，配合 LRU 上限防内存膨胀） */
const STRIP_CACHE_MAX = 200;
const stripCache = new Map<string, string>();

/**
 * 带缓存的 `stripMarkdown`（**内部用**）。
 *
 * 搜索路径上同一篇正文可能被匹配与取片段两次调用；缓存后避免重复 12 次正则替换。
 * 用 Map 的插入序实现简易 LRU（超限驱逐最旧）。
 *
 * @param source Markdown 原文
 * @returns 剥离后的近似纯文本（已小写）
 */
export function stripMarkdownCached(source: string): string {
  const hit = stripCache.get(source);
  if (hit !== undefined) {
    stripCache.delete(source);
    stripCache.set(source, hit);
    return hit;
  }
  const out = stripMarkdown(source).toLowerCase();
  stripCache.set(source, out);
  while (stripCache.size > STRIP_CACHE_MAX) {
    const oldest = stripCache.keys().next().value;
    if (oldest === undefined) break;
    stripCache.delete(oldest);
  }
  return out;
}

/**
 * 搜索匹配：标题 / 摘要 / 标签 / 正文（剥离 Markdown 后）任一包含关键词。
 *
 * ⚠️ 兼容保留（单测与需要「一次拿到完整判定」的场景）。**搜索 API 请勿用它做全表
 * 过滤** —— 它会为每篇文章剥离正文，属 O(N×正文)。API 走
 * `matchMeta` + `needsContentScan` 的两阶段路径（见 P0-2）。
 */
export function matchArticle(
  a: { title: string; summary: string; tags: string[]; content: string },
  q: string,
): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return matchMeta(a, q) || stripMarkdownCached(a.content).includes(query);
}
