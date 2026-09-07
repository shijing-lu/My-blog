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

/** 搜索匹配：标题 / 摘要 / 标签 / 正文（剥离 Markdown 后）任一包含关键词 */
export function matchArticle(
  a: { title: string; summary: string; tags: string[]; content: string },
  q: string,
): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return (
    a.title.toLowerCase().includes(query) ||
    a.summary.toLowerCase().includes(query) ||
    a.tags.some((t) => t.toLowerCase().includes(query)) ||
    stripMarkdown(a.content).toLowerCase().includes(query)
  );
}
