/**
 * editor-shortcuts.ts —— 编辑器快捷键的**服务端存取**（settings 表）
 *
 * 纯定义/规范化/冲突检测在 src/lib/editor-shortcut-defs.ts（客户端安全，React 岛可导入）；
 * 本模块只做 DB 读写（双写主备 upsert，与 site-name 同模式）。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import {
  DEFAULT_BINDINGS,
  normalizeBinding,
  type ShortcutDef,
} from './editor-shortcut-defs';

export type { ShortcutDef };
export {
  DEFAULT_BINDINGS,
  EDITOR_SHORTCUT_DEFS,
  bindingFromEvent,
  normalizeBinding,
  resolveBindings,
} from './editor-shortcut-defs';

/** 存储 key */
const KEY = 'editor_shortcuts';

/** 读取自定义绑定（无记录/损坏/未知 id/非法绑定 → 忽略，返回空对象） */
export async function getCustomBindings(): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { custom?: unknown };
    if (!parsed.custom || typeof parsed.custom !== 'object' || Array.isArray(parsed.custom)) return {};
    const out: Record<string, string> = {};
    for (const [id, b] of Object.entries(parsed.custom as Record<string, unknown>)) {
      const norm = normalizeBinding(b);
      if (norm && DEFAULT_BINDINGS[id]) out[id] = norm;
    }
    return out;
  } catch {
    return {};
  }
}

/** 保存自定义绑定（双写主备 upsert），返回规范化后的结果 */
export async function saveCustomBindings(input: unknown): Promise<Record<string, string>> {
  const custom: Record<string, string> = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [id, b] of Object.entries(input as Record<string, unknown>)) {
      if (!DEFAULT_BINDINGS[id]) continue; // 未知 id 忽略
      const norm = normalizeBinding(b);
      if (norm) custom[id] = norm;
    }
  }
  const now = new Date();
  const value = JSON.stringify({ custom });
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }),
  );
  return custom;
}
