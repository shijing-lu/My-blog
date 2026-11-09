/**
 * 导出 PDF 的分页计算（纯函数，无 DOM 依赖 → 可直接单测）
 *
 * ## 为什么需要它
 * 浏览器端没有「静默打印成 PDF」的 API（`window.print()` 必然弹系统打印对话框），
 * 因此网页版导出走「把正文画成画布 → 逐页塞进 PDF」。画布方案必须自己决定
 * **每一页从哪儿切**，本模块只做这件事：
 *
 * - 页高固定 = A4 去掉上下页边距；
 * - 优先把切点**吸附到块级元素边界**（公式块、代码块、表格、段落），
 *   避免把一行中文/一个公式拦腰截断；
 * - 吸附点离页顶太近（不足 40% 页高）时放弃吸附，否则页面会被切得七零八落。
 *
 * 桌面端（Electron `printToPDF`）走 Chromium 原生分页，不使用本模块。
 */

/** A4 与页边距（96dpi 的 CSS px；1px = 0.75pt） */
export const PDF_LAYOUT = {
  /** A4 宽：210mm @96dpi */
  pageWidthPx: 793.7,
  /** A4 高：297mm @96dpi */
  pageHeightPx: 1122.5,
  /** 页边距（≈12.7mm），与 print.css 的 18mm/16mm 视觉接近但为画布取整方便 */
  marginPx: 48,
  /** px → pt */
  pxToPt: 0.75,
} as const;

/** 正文可用宽度（px）：画布宽度 */
export const PDF_CONTENT_WIDTH_PX = Math.round(PDF_LAYOUT.pageWidthPx - PDF_LAYOUT.marginPx * 2);

/** 正文可用高度（px）：单页画布高度 */
export const PDF_PAGE_HEIGHT_PX = Math.floor(PDF_LAYOUT.pageHeightPx - PDF_LAYOUT.marginPx * 2);

/** 一页在正文坐标系里的窗口（top 相对正文顶部；height 为该页高度） */
export interface PdfPageWindow {
  top: number;
  height: number;
}

/** 吸附阈值：切点距页顶不足该比例时不吸附（宁可硬切，也不留大片空白） */
const SNAP_MIN_RATIO = 0.4;

/**
 * 计算分页窗口。
 *
 * @param totalHeight 正文总高（px，向上取整）
 * @param pageHeight  单页可用高（px）
 * @param snapPoints  候选切点（px，元素顶边相对正文顶部；无序、可重复）
 */
export function planPdfPages(
  totalHeight: number,
  pageHeight: number,
  snapPoints: readonly number[] = [],
): PdfPageWindow[] {
  const total = Math.max(0, Math.ceil(totalHeight));
  const page = Math.floor(pageHeight);
  if (total === 0 || page <= 0) return [];
  if (total <= page) return [{ top: 0, height: total }];

  // 去重、排序、只保留正文范围内的切点
  const points = [...new Set(snapPoints.map((point) => Math.round(point)))]
    .filter((point) => Number.isFinite(point) && point > 0 && point < total)
    .sort((a, b) => a - b);

  const pages: PdfPageWindow[] = [];
  let top = 0;
  while (total - top > page) {
    const limit = top + page;
    let next = limit;
    // 从大到小找「不超过页底」的切点：第一个命中即最接近页底的块边界
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const point = points[i]!;
      if (point > limit) continue;
      if (point <= top) break;
      if (point - top >= page * SNAP_MIN_RATIO) next = point;
      break;
    }
    if (next <= top) next = limit;
    pages.push({ top, height: next - top });
    top = next;
  }
  pages.push({ top, height: total - top });
  return pages;
}
