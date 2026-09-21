/**
 * 照片标签的纯函数工具（**服务端与客户端共用**）
 *
 * 为什么要单独一个模块：`src/lib/photos.ts` 引 drizzle/db，客户端脚本不能 import 它，
 * 于是 `gallery/upload.astro` 曾自己抄了一份 `MAX_TAGS` / `MAX_TAG_LEN` / 规范化逻辑。
 * 抄出来的那份与 `batchUpdateTags` 里的 `clean` 语义并不一致 —— 客户端那份额外做了
 * 去重 + 限 10 个，而服务端的 `clean` 只折叠空白与截断长度。结果：「移除」一次提交
 * **超过 10 个**标签时，界面少移除一部分，与服务端实际存下的内容不符（要刷新才对上）。
 *
 * 现在两边共用本模块，语义只有一处定义 —— 改这里就等于同时改服务端与客户端。
 *
 * 约束：本模块必须同构（isomorphic）—— 只允许纯字符串/数组操作，
 * **不得** import 任何引 db / drizzle 的模块。
 */

/** 单个标签最大长度 */
export const MAX_TAG_LEN = 20;

/** 单张照片最多标签数 */
export const MAX_TAGS = 10;

/** 批量标签操作类型 */
export type TagOp = 'set' | 'add' | 'remove';

/**
 * 基础净化：折叠内部空白并截断到 `MAX_TAG_LEN`（**不去重、不限个数**）。
 *
 * 之所以要和「写库前的去重限个」分开：批量操作是按这份集合做差集 / 合并的，
 * `remove` 的语义必须是「减掉用户写下的每一个标签」。若这里提前截到 10 个，
 * 用户一次写 12 个要移除的标签时就只会减掉 10 个 —— 与服务端不一致。
 */
export function cleanTags(tags: string[]): string[] {
  return tags.map((t) => t.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN)).filter(Boolean);
}

/**
 * 写库 / 展示前的规范化：净化 + 去重 + 最多 `MAX_TAGS` 个（保持首次出现顺序）。
 *
 * 与 `photos.ts` 的 `serializeTags` 的净化部分逐字一致 —— 后者只多一步 `JSON.stringify`，
 * 因此 `JSON.parse(serializeTags(x))` 恒等于 `normalizeTags(x)`（有测试锁定）。
 */
export function normalizeTags(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const v = t.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** 「风景,旅行,2024」→ ['风景','旅行','2024']（中英文逗号均可，去空去重） */
export function parseTagsInput(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
}

/**
 * 计算批量操作后的标签集合 —— 与服务端 `batchUpdateTags` 的算法逐字对应：
 * - `set`：覆盖为给定标签（空数组 = 清空）
 * - `add`：合并追加
 * - `remove`：减去给定标签
 *
 * 这里只做集合运算，**不做去重 / 限个** —— 那一步交给 `normalizeTags`
 * （服务端交给 `serializeTags`），这样三种操作的语义都与用户输入严格一致。
 */
export function combineTags(current: string[], op: TagOp, tags: string[]): string[] {
  const clean = cleanTags(tags);
  if (op === 'set') return clean;
  if (op === 'add') return [...new Set([...current, ...clean])];
  return current.filter((t) => !clean.includes(t));
}
