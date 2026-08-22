/**
 * 主题可用的字体族（需随包：fontsource Lora / Silkscreen）
 *
 * 主题通过 `fontSans` / `fontDisplay` / `fontPixel` 选择：
 * - 无像素修饰的主题把 `fontPixel` 设为 sans；
 * - 科技主题可把 `fontPixel` 设为 mono。
 */

/** 正文字体（系统栈） */
export const FONT_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/** 标题衬线（Lora + 中文回退宋体系） */
export const FONT_DISPLAY =
  '"Lora", ui-serif, Georgia, "Songti SC", "Noto Serif SC", serif';

/** 像素字体（Silkscreen 负责拉丁；中文用自托管 Fusion Pixel） */
export const FONT_PIXEL = '"Silkscreen", "Fusion Pixel", ui-monospace, "SFMono-Regular", Menlo, monospace';

/** 等宽字体（科技/代码风） */
export const FONT_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
