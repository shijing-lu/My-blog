/**
 * 文章阅读统计
 */

/** 粗略字数（去除空白后的字符数） */
export function countChars(markdown: string): number {
  return markdown.replace(/\s+/g, '').length;
}

/** 阅读时长（分钟，中文按 ~400 字/分钟估算，最少 1 分钟） */
export function readingTime(markdown: string): number {
  return Math.max(1, Math.round(countChars(markdown) / 400));
}
