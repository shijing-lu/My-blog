/**
 * 标签编解码（string[] ↔ 存储形态）
 *
 * 存储形态因方言而异：
 * - SQLite：JSON 文本（`text` 列）；
 * - PostgreSQL：`jsonb` 数组（select 返回原生数组）。
 * 本模块统一对外形态为 `string[]`，写入一律 `JSON.stringify`（pg jsonb 接受 JSON
 * 字符串入参并自动解析），读取做归一化。
 */

/**
 * 将标签数组序列化为存储值（trim + 去空 + 去重）
 *
 * @param tags 原始标签数组
 * @returns 可用于 sqlite / pg 列写入的字符串
 */
export function serializeTags(tags: string[]): string {
  const cleaned = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  return JSON.stringify(cleaned);
}

/**
 * 将存储值解析为标签数组（兼容字符串 / 数组两种形态）
 *
 * @param raw 数据库读取的原始值
 * @returns 规范化后的标签数组（非法输入返回空数组）
 */
export function parseTags(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
      }
    } catch {
      // 非法 JSON：按空数组处理
    }
  }
  return [];
}
