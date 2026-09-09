/**
 * 自定义 Markdown 样式（DB settings 表持久化，管理员在设置页上传 CSS 覆盖全站 Markdown 渲染）
 *
 * - 存储：settings 表的 `md_custom_css` 键，value 直接存 CSS 文本（非 JSON）；
 * - 应用：BaseLayout 每页 SSR 注入 <style>（scopeMdCss 作用域化后），覆盖全站所有 .prose
 *   渲染处（文章 / 文档 / 动态 / 动态卡片等 Markdown HTML 输出）；
 * - 纯函数（sanitize/scope）在同目录 md-css-scope.ts（零依赖，前端预览共用）。
 */

import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import { sanitizeMdCss } from './md-css-scope';

export { MAX_MD_CSS_CHARS, sanitizeMdCss, scopeMdCss } from './md-css-scope';

/** settings 表键 */
const KEY = 'md_custom_css';

/** 当前自定义样式（css 为空串 = 未自定义，用站点默认） */
export interface CustomMdCss {
  css: string;
  /** 最近更新时间（ms epoch；null = 从未自定义） */
  updatedAt: number | null;
}

/** 读取自定义 Markdown 样式（无记录/读库失败回落未自定义） */
export async function getCustomMdCss(): Promise<CustomMdCss> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (typeof raw !== 'string') return { css: '', updatedAt: null };
    const t = rows[0]?.updatedAt;
    const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : null;
    return { css: raw, updatedAt: ms };
  } catch {
    return { css: '', updatedAt: null };
  }
}

/** 保存自定义 Markdown 样式（upsert；css 先经 sanitizeMdCss 净化） */
export async function saveCustomMdCss(css: string): Promise<CustomMdCss> {
  const clean = sanitizeMdCss(css);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: clean, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: clean, updatedAt: now },
      }),
  );
  return { css: clean, updatedAt: now.getTime() };
}

/** 清除自定义样式（恢复站点默认） */
export async function clearCustomMdCss(): Promise<void> {
  await dbWrite((d) => d.delete(settings).where(eq(settings.key, KEY)));
}
