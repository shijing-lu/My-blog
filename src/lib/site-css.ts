/**
 * 全站文字自定义样式（DB settings 表持久化；管理员在设置页编辑，覆盖内置默认风格包）
 *
 * - 存储：settings 表的 `site_custom_css` 键，value 直接存 CSS 文本（非 JSON）；
 * - 应用：BaseLayout 每页 SSR 注入两层——
 *     ① `@layer site-text { 内置默认风格包 }`（始终注入，见 site-css-defaults.ts）；
 *     ② 管理员自定义 CSS（unlayered，源序靠后）→ 稳定覆盖 ①；
 * - 与「Markdown 样式」（md_custom_css）的关系：后者经 scopeMdCss 限定在 .prose 且
 *   unlayered，优先级高于本功能的 site-text 层——两功能叠加时 Markdown 区域以内
 *   Markdown 样式为准，其余区域以本功能为准；
 * - 纯函数净化复用 md-css-scope 的 sanitizeMdCss（剔除 </style>、截断 64KB）。
 */

import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import { sanitizeMdCss } from './md-css-scope';

export { MAX_MD_CSS_CHARS, sanitizeMdCss } from './md-css-scope';

/** settings 表键 */
const KEY = 'site_custom_css';

/** 当前自定义样式（css 为空串 = 未自定义，用内置默认风格包） */
export interface CustomSiteCss {
  css: string;
  /** 最近更新时间（ms epoch；null = 从未自定义） */
  updatedAt: number | null;
}

/** 读取自定义全站样式（无记录/读库失败回落未自定义） */
export async function getCustomSiteCss(): Promise<CustomSiteCss> {
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

/** 保存自定义全站样式（upsert；css 先经 sanitizeMdCss 净化） */
export async function saveCustomSiteCss(css: string): Promise<CustomSiteCss> {
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

/** 清除自定义样式（回到内置默认风格包） */
export async function clearCustomSiteCss(): Promise<void> {
  await dbWrite((d) => d.delete(settings).where(eq(settings.key, KEY)));
}
