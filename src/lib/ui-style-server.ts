import { eq } from 'drizzle-orm';
import { db, dbWrite } from '../../db';
import { settings } from '../../db/schema.sqlite';
import { isUiStyle, UI_STYLE_SETTINGS_KEY, type UiStyle } from './ui-style';

/** Older installations have no row and keep their existing appearance. */
export async function getSiteUiStyle(options: { fallbackOnError?: boolean } = {}): Promise<UiStyle> {
  try {
    const rows = await db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, UI_STYLE_SETTINGS_KEY)).limit(1);
    const value: unknown = rows[0]?.value ? JSON.parse(rows[0].value) : null;
    const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>).defaultStyle : value;
    return isUiStyle(candidate) ? candidate : 'classic';
  } catch (error) {
    if (options.fallbackOnError === false) throw error;
    return 'classic';
  }
}

/** Uses the same mirrored settings write as other site preferences. */
export async function saveSiteUiStyle(defaultStyle: UiStyle): Promise<UiStyle> {
  if (!isUiStyle(defaultStyle)) throw new TypeError('Invalid UI style');
  const value = JSON.stringify({ defaultStyle });
  const updatedAt = new Date();
  await dbWrite((database) => database.insert(settings)
    .values({ key: UI_STYLE_SETTINGS_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } }));
  return defaultStyle;
}
