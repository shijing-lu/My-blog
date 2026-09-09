/**
 * Markdown 样式库——命名样式列表（DB settings 表持久化）
 *
 * - 存储：settings 表的 `md_css_library` 键，value = JSON 数组 [{id, name, css, updatedAt}]；
 *   选数据库而非 R2：CSS 是 ≤64KB 小文本、需列表/单条查询与改名更新，KV JSON 单键读写最简；
 *   R2 面向大文件二进制对象，无查询能力，还要额外建索引表，得不偿失。
 * - 上限：MAX_MD_CSS_ITEMS 条；每条 CSS 经 sanitizeMdCss 净化（</style> 逃逸 + 64KB 截断）。
 * - 与「当前生效样式」（md_custom_css 键）解耦：库里保存 ≠ 全站应用，应用仍走 PUT /api/md-css。
 */

import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import { sanitizeMdCss } from './md-css-scope';

/** settings 表键 */
const KEY = 'md_css_library';

/** 样式库条目上限 */
export const MAX_MD_CSS_ITEMS = 30;
/** 样式名称长度上限（字符） */
export const MAX_MD_CSS_NAME_CHARS = 50;

export interface MdCssLibraryItem {
  id: string;
  name: string;
  css: string;
  /** 最近更新时间（ms epoch） */
  updatedAt: number;
}

/** 行结构校验（存量数据防脏） */
function isItem(v: unknown): v is MdCssLibraryItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.css === 'string';
}

/** 读取样式库（无记录/解析失败回落空列表） */
export async function getMdCssLibrary(): Promise<MdCssLibraryItem[]> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (typeof raw !== 'string' || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).map((it) => ({ ...it, updatedAt: Number(it.updatedAt) || 0 }));
  } catch {
    return [];
  }
}

/** 读取单条样式 */
export async function getMdCssLibraryItem(id: string): Promise<MdCssLibraryItem | null> {
  if (!id) return null;
  const items = await getMdCssLibrary();
  return items.find((it) => it.id === id) ?? null;
}

/** 新增样式（返回新条目；库满抛错由 API 层转 4xx） */
export async function addMdCssLibraryItem(name: string, css: string): Promise<MdCssLibraryItem> {
  const items = await getMdCssLibrary();
  if (items.length >= MAX_MD_CSS_ITEMS) {
    throw new Error(`样式库已满（上限 ${MAX_MD_CSS_ITEMS} 个），请先删除不用的样式`);
  }
  const item: MdCssLibraryItem = {
    id: crypto.randomUUID(),
    name: name.slice(0, MAX_MD_CSS_NAME_CHARS),
    css: sanitizeMdCss(css),
    updatedAt: Date.now(),
  };
  await writeLibrary([...items, item]);
  return item;
}

/** 更新样式（name/css 可选；不存在返回 null） */
export async function updateMdCssLibraryItem(
  id: string,
  patch: { name?: string; css?: string },
): Promise<MdCssLibraryItem | null> {
  const items = await getMdCssLibrary();
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const prev = items[idx]!;
  const next: MdCssLibraryItem = {
    ...prev,
    ...(patch.name !== undefined ? { name: patch.name.slice(0, MAX_MD_CSS_NAME_CHARS) } : {}),
    ...(patch.css !== undefined ? { css: sanitizeMdCss(patch.css) } : {}),
    updatedAt: Date.now(),
  };
  const out = [...items];
  out[idx] = next;
  await writeLibrary(out);
  return next;
}

/** 删除样式（返回是否存在） */
export async function deleteMdCssLibraryItem(id: string): Promise<boolean> {
  const items = await getMdCssLibrary();
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return false;
  await writeLibrary(next);
  return true;
}

/** 整表写回（upsert） */
async function writeLibrary(items: MdCssLibraryItem[]): Promise<void> {
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify(items), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(items), updatedAt: now } }),
  );
}
