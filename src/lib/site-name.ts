/**
 * 站点名称设置（导航栏品牌文字）
 *
 * - 存储：settings 表 `site_name` 键（JSON `{"name":"..."}`），管理员在 /admin/settings 配置；
 * - 读取：BaseLayout / AdminLayout 服务端渲染导航栏品牌文字与 <title> 站名后缀；
 * - 未设置时默认「白衣卿相」；名称做 trim / 去换行 / 截断（≤30 字符），空值回落默认。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** 默认站点名称（用户未设置时显示） */
export const DEFAULT_SITE_NAME = '白衣卿相';

/** 名称长度上限 */
export const MAX_SITE_NAME_LENGTH = 30;

/** 配置键 */
const KEY = 'site_name';

/** 规范化名称：trim + 去换行 + 截断；空值回落默认 */
export function normalizeSiteName(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_SITE_NAME;
  const name = input
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_SITE_NAME_LENGTH);
  return name || DEFAULT_SITE_NAME;
}

/** 读取站点名称（DB 优先，无记录/损坏回落默认） */
export async function getSiteName(): Promise<string> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_SITE_NAME;
    const parsed = JSON.parse(raw) as { name?: unknown };
    return normalizeSiteName(parsed.name);
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

/** 保存站点名称（双写主备，upsert），返回规范化后的名称 */
export async function saveSiteName(input: unknown): Promise<string> {
  const name = normalizeSiteName(input);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify({ name }), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify({ name }), updatedAt: now } }),
  );
  return name;
}
