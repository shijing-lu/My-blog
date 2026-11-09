/**
 * 浏览器端「直接导出 PDF」（画布方案，无打印对话框）
 *
 * ## 为什么是这个方案
 * 网页里没有静默打印成 PDF 的 API：`window.print()` 一定弹系统打印对话框，
 * 正是用户报的「走了打印机的页面」。所以网页版把正文离屏渲染成画布，
 * 再逐页写进 PDF 并直接下载——点击即出文件。
 * 桌面端（Electron）走主进程 `printToPDF`（矢量、文本可选、原生分页），见 lib/pdf-export.ts。
 *
 * ## 实现要点
 * - **离屏载体**：`.pdf-export-viewport`（fixed + 左移 100000px）只露出「一页」，
 *   内容整体上移 `-top` 即得该页窗口；视口高 = 本次要渲染的页组总高。
 * - **一次渲染多页**：html2canvas 每次调用都会克隆整个文档，逐页调用会成倍变慢；
 *   这里一次渲染 4 页再由画布切片，兼顾内存与速度。
 * - **分页吸附**：切点交给 pdf-pagination 的 `planPdfPages`，尽量落在块级元素边界。
 * - **图片同源**：画布不允许跨域像素，R2 等跨域图先改写为同源代理
 *   （`/api/export/image?url=`），否则 `toDataURL` 抛 SecurityError。
 */
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  PDF_CONTENT_WIDTH_PX,
  PDF_LAYOUT,
  PDF_PAGE_HEIGHT_PX,
  planPdfPages,
} from './pdf-pagination';
import { pdfFileName, waitForExportAssets } from './pdf-export-prep';

export interface RasterPdfOptions {
  /** 正文根节点（`article.prose`） */
  root: HTMLElement;
  title: string;
  /** 页眉副标题（站点名 / 导出时间 / 来源地址） */
  subtitle?: string;
  onStatus?: (message: string) => void;
  /** 调试钩子：交出每页画布（离线验收脚本用，生产不传） */
  onPageCanvas?: (canvas: HTMLCanvasElement, index: number) => void;
  /** 画布倍率（默认 2 ≈ 192dpi，中文小字足够清晰） */
  scale?: number;
}

/** 单次 html2canvas 渲染的页数（越大越省调用次数，但画布越高越吃内存） */
const CHUNK_PAGES = 4;

/** 导出时从正文里剔除的交互件（CSS 的 .no-print 之外，这些元素必须物理移除） */
const STRIP_SELECTOR = [
  'script',
  'style',
  'link',
  'noscript',
  '[data-code-toggle]',
  '[data-copy]',
  '.callout-copy',
  '[data-mermaid-toggle]',
  '.spoiler-toggle-wrap',
  '.body-heading-toggle',
  '[data-markdown-export-drag]',
  '.no-print',
  '.export-menu',
].join(',');

/** 把正文深拷贝整理成「纸面稿」：去掉 id / 交互件，展开折叠、揭示黑幕 */
function prepareClone(clone: HTMLElement, doc: Document): void {
  clone.querySelectorAll(STRIP_SELECTOR).forEach((node) => node.remove());
  clone.removeAttribute('id');
  clone.removeAttribute('data-defer-article');
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
  clone.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
  clone.querySelectorAll<HTMLDetailsElement>('details').forEach((node) => {
    node.open = true;
    node.removeAttribute('name');
  });
  clone.querySelectorAll<HTMLElement>('[data-body-heading-content][hidden]').forEach((node) => node.removeAttribute('hidden'));
  clone.querySelectorAll<HTMLElement>('[data-code-block][data-collapsed]').forEach((node) => node.removeAttribute('data-collapsed'));
  clone.querySelectorAll<HTMLElement>('.spoiler[data-spoiler]').forEach((node) => {
    node.setAttribute('aria-expanded', 'true');
    node.classList.add('is-open');
  });
  rewriteCrossOriginImages(clone, doc);
}

/** 跨域图片改写为同源代理：画布必须同源，否则 toDataURL 抛 SecurityError */
function rewriteCrossOriginImages(root: HTMLElement, doc: Document): void {
  const origin = doc.defaultView?.location.origin ?? '';
  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const raw = img.getAttribute('src') ?? '';
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return;
    try {
      const url = new URL(raw, doc.baseURI);
      if (url.origin === origin) return;
      img.setAttribute('src', `/api/export/image?url=${encodeURIComponent(url.href)}`);
    } catch {
      /* 非 URL（例如 github 相对路径解析失败）时保持原样 */
    }
  });
}

/** 候选切点：正文顶层块 + 章节内容块 + 常见的「不可切断」块（相对正文顶部的偏移） */
function measureSnapPoints(holder: HTMLElement, clone: HTMLElement): number[] {
  const base = holder.getBoundingClientRect().top;
  const points = new Set<number>();
  points.add(Math.round(clone.getBoundingClientRect().top - base));
  const nodes = clone.querySelectorAll<HTMLElement>(
    ':scope > *, [data-body-heading-content] > *, [data-body-heading-section] > *, pre, table, figure, blockquote, .katex-display',
  );
  for (const node of nodes) {
    const top = Math.round(node.getBoundingClientRect().top - base);
    if (top > 0) points.add(top);
  }
  return [...points];
}

/** 从整组画布里切出单页画布（底部不足一页时补白） */
function sliceCanvas(
  doc: Document,
  source: HTMLCanvasElement,
  offsetPx: number,
  heightPx: number,
  scale: number,
): HTMLCanvasElement {
  const target = doc.createElement('canvas');
  target.width = source.width;
  target.height = Math.max(1, Math.round(heightPx * scale));
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持画布导出');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);
  const sourceY = Math.round(offsetPx * scale);
  const copyHeight = Math.min(target.height, source.height - sourceY);
  if (copyHeight > 0) ctx.drawImage(source, 0, sourceY, source.width, copyHeight, 0, 0, source.width, copyHeight);
  return target;
}

/** 等两帧：让离屏载体的新高度/偏移先完成布局再截图 */
function nextFrame(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const view = doc.defaultView;
    if (!view) {
      resolve();
      return;
    }
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
  });
}

/**
 * 把正文导出为 PDF 并直接下载。
 * 调用方需先执行 `preparePdfExport`（黑幕/折叠/浅色），本函数只负责渲染与下载。
 */
export async function exportPdfRaster(options: RasterPdfOptions): Promise<void> {
  const doc = options.root.ownerDocument;
  const scale = options.scale ?? 2;

  const holder = doc.createElement('div');
  holder.className = 'pdf-export-root';
  const viewport = doc.createElement('div');
  viewport.className = 'pdf-export-viewport';
  viewport.setAttribute('aria-hidden', 'true');
  viewport.appendChild(holder);
  doc.body.appendChild(viewport);

  try {
    const header = doc.createElement('header');
    header.className = 'pdf-export-header';
    const heading = doc.createElement('h1');
    heading.textContent = options.title;
    header.appendChild(heading);
    if (options.subtitle) {
      const meta = doc.createElement('p');
      meta.className = 'pdf-export-meta';
      meta.textContent = options.subtitle;
      header.appendChild(meta);
    }
    holder.appendChild(header);

    const clone = options.root.cloneNode(true) as HTMLElement;
    prepareClone(clone, doc);
    holder.appendChild(clone);

    options.onStatus?.('正在准备正文…');
    await waitForExportAssets(holder);

    const totalHeight = Math.ceil(holder.getBoundingClientRect().height);
    if (totalHeight <= 0) throw new Error('正文为空，无法导出');
    const pages = planPdfPages(totalHeight, PDF_PAGE_HEIGHT_PX, measureSnapPoints(holder, clone));
    if (pages.length === 0) throw new Error('正文为空，无法导出');

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
    const marginPt = PDF_LAYOUT.marginPx * PDF_LAYOUT.pxToPt;
    const contentWidthPt = PDF_CONTENT_WIDTH_PX * PDF_LAYOUT.pxToPt;

    let pageIndex = 0;
    for (let start = 0; start < pages.length; start += CHUNK_PAGES) {
      const group = pages.slice(start, start + CHUNK_PAGES);
      const groupHeight = group.reduce((sum, page) => sum + page.height, 0);
      const first = group[0]!;
      options.onStatus?.(`正在渲染 ${start + 1}/${pages.length} 页…`);

      viewport.style.height = `${groupHeight}px`;
      holder.style.marginTop = `${-first.top}px`;
      await nextFrame(doc);

      const canvas = await html2canvas(viewport, {
        width: PDF_CONTENT_WIDTH_PX,
        height: groupHeight,
        windowWidth: PDF_CONTENT_WIDTH_PX + 16,
        windowHeight: groupHeight + 16,
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        imageTimeout: 15_000,
      });

      let offset = 0;
      for (const page of group) {
        const slice = sliceCanvas(doc, canvas, offset, page.height, scale);
        options.onPageCanvas?.(slice, pageIndex);
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(
          slice.toDataURL('image/jpeg', 0.92),
          'JPEG',
          marginPt,
          marginPt,
          contentWidthPt,
          page.height * PDF_LAYOUT.pxToPt,
        );
        pageIndex += 1;
        offset += page.height;
        options.onStatus?.(`已生成 ${pageIndex}/${pages.length} 页`);
      }
      // 尽早释放大画布，长文导出时内存峰值主要在这里
      canvas.width = 0;
      canvas.height = 0;
    }

    pdf.save(pdfFileName(options.title));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error('图片跨域导致导出失败，请检查图片域名是否允许同源代理');
    }
    throw error;
  } finally {
    viewport.remove();
  }
}
