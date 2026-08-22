/**
 * Slug 生成（中文兼容）
 *
 * 流程：transliteration 将 CJK 转拼音（保留 ASCII）→ github-slugger 归一化为
 * 小写 + 连字符的 URL 安全形式。纯英文输入不受影响。
 */
import GithubSlugger from 'github-slugger';
import { transliterate } from 'transliteration';

/**
 * 将任意文本转为 URL 安全 slug（中文 → 拼音）
 *
 * @param input 原始文本（如标题）
 * @returns slug；输入为空返回空字符串（由调用方兜底）
 */
export function slugify(input: string): string {
  const normalized = transliterate(input, { unknown: '' }).trim();
  const slugger = new GithubSlugger();
  return slugger.slug(normalized);
}

/**
 * 由标题生成 slug，空标题时给出稳定兜底值
 *
 * @param title 标题
 * @returns 非空 slug
 */
export function slugifyOrFallback(title: string): string {
  const slug = slugify(title);
  return slug || 'untitled';
}
