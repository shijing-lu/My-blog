/**
 * 字体系统数据访问层
 *
 * - 自定义字体：fonts 表存 base64（与 images 同模式），/api/fonts/[id] 输出；
 * - 全局字体设置：settings 表 `site_fonts` 键（JSON：文章字体 + 其他字体），
 *   BaseLayout 读取后注入 @font-face 与 CSS 变量覆盖。
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { fonts, settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import type { BlogFont, FontChoice, SiteFonts } from '../../db/types';

/** 字体设置键 */
const SETTINGS_KEY = 'site_fonts';

/** 默认：系统无衬线（正文）+ Lora（标题/装饰） */
export const DEFAULT_FONTS: SiteFonts = {
  article: { type: 'system', value: 'sans' },
  ui: { type: 'builtin', value: 'lora' },
};

/** 内置字体清单（设置页下拉展示） */
export const BUILTIN_FONTS: { key: string; label: string; family: string; fallback: string }[] = [
  { key: 'lora', label: 'Lora（文艺衬线）', family: 'Lora', fallback: 'Georgia, serif' },
  { key: 'silkscreen', label: 'Silkscreen（像素）', family: 'Silkscreen', fallback: 'monospace' },
  { key: 'noto-serif-sc', label: '思源宋体 Noto Serif SC', family: 'Noto Serif SC', fallback: 'serif' },
  { key: 'zcool-kuai-le', label: '站酷快乐体 ZCOOL KuaiLe', family: 'ZCOOL KuaiLe', fallback: 'cursive' },
];

/** 系统字体栈 */
export const SYSTEM_FONTS: { key: string; label: string; stack: string }[] = [
  { key: 'sans', label: '系统无衬线（默认）', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif' },
  { key: 'serif', label: '系统衬线（宋体）', stack: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif' },
  { key: 'mono', label: '系统等宽', stack: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace' },
];

/** 校验字体选择 */
function normalizeChoice(input: unknown): FontChoice {
  const c = (input ?? {}) as Partial<FontChoice>;
  const type = c.type === 'builtin' || c.type === 'custom' ? c.type : 'system';
  const value = typeof c.value === 'string' && c.value.trim() !== '' ? c.value.trim().slice(0, 200) : 'sans';
  return { type, value };
}

/** 规范化设置 */
function normalize(input: Partial<SiteFonts> | null): SiteFonts {
  return {
    article: normalizeChoice(input?.article),
    ui: normalizeChoice(input?.ui),
  };
}

/** 读取全局字体设置 */
export async function getSiteFonts(): Promise<SiteFonts> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_FONTS;
    return normalize(JSON.parse(raw) as Partial<SiteFonts>);
  } catch {
    return DEFAULT_FONTS;
  }
}

/** 保存字体设置 */
export async function saveSiteFonts(input: Partial<SiteFonts>): Promise<SiteFonts> {
  const normalized = normalize(input);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: JSON.stringify(normalized), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt: now } }),
  );
  return normalized;
}

/**
 * 是否已手动设置字体（settings 表存在 site_fonts 记录）。
 *
 * 优先级规则：手动设置过 → 全站优先于主题字体；从未设置 → 跟随当前主题的字体
 * （主题通过 html[data-theme] 覆盖 --font-sans-family / --font-display-family）。
 */
export async function hasManualFontSettings(): Promise<boolean> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** 清除手动字体设置（恢复跟随主题字体） */
export async function clearSiteFonts(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, SETTINGS_KEY));
}

/* ---------------- 自定义字体 ---------------- */

/** 保存上传的字体（base64） */
export async function addFont(input: { familyName: string; mime: string; dataBase64: string }): Promise<BlogFont> {
  const size = Buffer.from(input.dataBase64, 'base64').length;
  const rows = await db
    .insert(fonts)
    .values({
      id: randomUUID(),
      familyName: input.familyName,
      mime: input.mime,
      data: input.dataBase64,
      size,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as BlogFont;
}

/** 保存上传的字体（Vercel Blob 直传，data 存公开 URL） */
export async function addFontBlob(input: { familyName: string; mime: string; url: string; size: number }): Promise<BlogFont> {
  const rows = await db
    .insert(fonts)
    .values({
      id: randomUUID(),
      familyName: input.familyName,
      mime: input.mime,
      data: input.url,
      size: input.size,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as BlogFont;
}

/** 判断字体 data 是否为 Blob URL（而非 base64） */
export function isBlobFontData(data: string): boolean {
  return typeof data === 'string' && data.startsWith('http');
}

/** 列出全部自定义字体（不含 data，列表用） */
export async function listFontsMeta(): Promise<Omit<BlogFont, 'data'>[]> {
  const rows = await db
    .select({ id: fonts.id, familyName: fonts.familyName, mime: fonts.mime, size: fonts.size, createdAt: fonts.createdAt })
    .from(fonts)
    .orderBy(fonts.createdAt);
  return rows;
}

/** 按 id 取字体（含 data，供 /api/fonts/[id] 输出） */
export async function getFontById(id: string): Promise<BlogFont | null> {
  const rows = await db.select().from(fonts).where(eq(fonts.id, id)).limit(1);
  return (rows[0] as BlogFont | undefined) ?? null;
}

/** 批量取字体（供 BaseLayout 注入 @font-face） */
export async function getFontsByIds(ids: string[]): Promise<BlogFont[]> {
  if (ids.length === 0) return [];
  const { inArray } = await import('drizzle-orm');
  const rows = await db.select().from(fonts).where(inArray(fonts.id, ids));
  return rows as BlogFont[];
}

/** 删除字体 */
export async function deleteFont(id: string): Promise<void> {
  await db.delete(fonts).where(eq(fonts.id, id));
}

/* ---------------- CSS 生成（BaseLayout 注入） ---------------- */

/** 默认正文栈 */
const DEFAULT_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/** 单个字体选择的 font-family 栈 */
function choiceStack(choice: FontChoice, customFonts: BlogFont[]): string {
  if (choice.type === 'system') {
    const s = SYSTEM_FONTS.find((x) => x.key === choice.value);
    return s ? s.stack : DEFAULT_SANS;
  }
  if (choice.type === 'builtin') {
    const b = BUILTIN_FONTS.find((x) => x.key === choice.value);
    if (b) return `"${b.family}", ${b.fallback}`;
    return DEFAULT_SANS;
  }
  const f = customFonts.find((x) => x.id === choice.value);
  if (f) return `"${f.familyName}", ${DEFAULT_SANS}`;
  return DEFAULT_SANS;
}

/** 自定义字体的 @font-face 片段（Blob 字体直链 URL；base64 字体走 /api/fonts/[id]） */
function fontFaceCss(font: BlogFont): string {
  const format = font.mime.includes('woff2') ? 'woff2' : font.mime.includes('ttf') ? 'truetype' : font.mime.includes('otf') ? 'opentype' : 'woff2';
  if (isBlobFontData(font.data)) {
    const url = font.data.replace(/"/g, '\\"');
    return `@font-face{font-family:"${font.familyName}";src:url("${url}") format("${format}");font-display:swap;}`;
  }
  return `@font-face{font-family:"${font.familyName}";src:url("/api/fonts/${font.id}") format("${format}");font-display:swap;}`;
}

/**
 * 生成全局字体覆盖 CSS（仅当用户手动设置过字体时由 BaseLayout 注入）
 *
 * 手动设置优先级高于主题：主题字体通过 `html[data-theme='id']`（特异性 0,1,1）
 * 覆盖三个字体变量，因此这里用 `html` + `!important` 压过所有主题
 * （含运行时注入的自定义主题 CSS）。
 * - --font-sans-family：文章字体（正文 .prose）
 * - --font-display-family + --font-pixel-family：「其他字体」——标题/UI/评论/动态/
 *   界面默认文字/像素装饰全部统一为所选字体。
 * 未手动设置时不注入本 CSS，界面跟随主题自带字体（body/h1-h4 默认用
 * --font-pixel-family：claude-pixel/terminal=像素、graphite=等宽等）。
 */
export function buildFontCss(fonts: SiteFonts, customFonts: BlogFont[]): string {
  const faces = customFonts.map((f) => fontFaceCss(f)).join('');
  const article = choiceStack(fonts.article, customFonts);
  const ui = choiceStack(fonts.ui, customFonts);
  return `${faces}html{--font-sans-family:${article} !important;--font-display-family:${ui} !important;--font-pixel-family:${ui} !important;}`;
}
