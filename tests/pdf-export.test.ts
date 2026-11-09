/**
 * 导出 PDF 单测（纯函数 + 轻量假 DOM）
 *
 * 覆盖两块最容易回归的逻辑：
 * 1. `pdf-pagination.ts` 的分页窗口计算（不足一页 / 整页 / 块边界吸附 / 异常切点）；
 * 2. `pdf-export-prep.ts` 的「纸面态」准备与还原（折叠全展开、手风琴组名两阶段还原、
 *    章节折叠与代码块折叠、浅色主题与黑幕开关）。
 *
 * 浏览器端画布渲染（html2canvas-pro + jsPDF）与桌面端 printToPDF 属真实渲染路径，
 * 由 `scripts/diag-pdf-export.mjs` 的 Edge 离屏验收覆盖，不在此处 mock。
 */
import { describe, expect, it } from 'vitest';
import {
  PDF_CONTENT_WIDTH_PX,
  PDF_LAYOUT,
  PDF_PAGE_HEIGHT_PX,
  planPdfPages,
} from '../src/lib/pdf-pagination';
import { pdfFileName, preparePdfExport } from '../src/lib/pdf-export-prep';

describe('A4 版面常量（画布与 PDF 页对齐）', () => {
  it('正文宽度与页高由 A4 尺寸减去页边距得出', () => {
    expect(PDF_CONTENT_WIDTH_PX).toBe(Math.round(PDF_LAYOUT.pageWidthPx - PDF_LAYOUT.marginPx * 2));
    expect(PDF_PAGE_HEIGHT_PX).toBe(Math.floor(PDF_LAYOUT.pageHeightPx - PDF_LAYOUT.marginPx * 2));
    expect(PDF_CONTENT_WIDTH_PX).toBe(698);
    expect(PDF_PAGE_HEIGHT_PX).toBe(1026);
  });

  it('px → pt 换算为 96dpi/72dpi', () => {
    expect(PDF_LAYOUT.pxToPt).toBeCloseTo(0.75, 6);
  });
});

describe('分页窗口计算（planPdfPages）', () => {
  const PAGE = 1000;

  it('空正文不出页', () => {
    expect(planPdfPages(0, PAGE)).toEqual([]);
    expect(planPdfPages(-10, PAGE)).toEqual([]);
    expect(planPdfPages(120, 0)).toEqual([]);
  });

  it('不足一页时只有一页，且高度等于正文总高', () => {
    expect(planPdfPages(640.4, PAGE)).toEqual([{ top: 0, height: 641 }]);
  });

  it('整页高度时刚好一页（不产生空尾页）', () => {
    expect(planPdfPages(1000, PAGE)).toEqual([{ top: 0, height: 1000 }]);
  });

  it('超出部分逐页切分且末页取余量', () => {
    expect(planPdfPages(3078, PAGE)).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
      { top: 2000, height: 1000 },
      { top: 3000, height: 78 },
    ]);
  });

  it('吸附到块边界，避免把段落/公式拦腰切断', () => {
    expect(planPdfPages(2000, PAGE, [900])).toEqual([
      { top: 0, height: 900 },
      { top: 900, height: 1000 },
      { top: 1900, height: 100 },
    ]);
  });

  it('多个候选切点时取「最靠近页底」的那个', () => {
    expect(planPdfPages(2000, PAGE, [300, 700, 960])).toEqual([
      { top: 0, height: 960 },
      { top: 960, height: 1000 },
      { top: 1960, height: 40 },
    ]);
  });

  it('切点太靠上（不足 40% 页高）时放弃吸附，改为硬切', () => {
    expect(planPdfPages(2000, PAGE, [120])).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
    ]);
  });

  it('忽略越界、重复、非数值切点', () => {
    expect(planPdfPages(2000, PAGE, [0, -5, 2500, 800, 800, Number.NaN, Number.POSITIVE_INFINITY])).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 1000 },
      { top: 1800, height: 200 },
    ]);
  });

  it('分页结果连续且完整覆盖正文（不重不漏）', () => {
    const pages = planPdfPages(9876.5, PDF_PAGE_HEIGHT_PX, [500, 2100, 2100, 4000, 7300, 9000]);
    let cursor = 0;
    for (const page of pages) {
      expect(page.top).toBe(cursor);
      expect(page.height).toBeGreaterThan(0);
      expect(page.height).toBeLessThanOrEqual(PDF_PAGE_HEIGHT_PX);
      cursor += page.height;
    }
    expect(cursor).toBe(9877);
  });
});

/* ------------------------------------------------------------------ *
 * 「纸面态」准备与还原：用最小假 DOM（只需 getAttribute/setAttribute/
 * removeAttribute/open/classList 与 querySelectorAll 分组）驱动真实实现。
 * ------------------------------------------------------------------ */
class FakeClassList {
  private readonly set: Set<string>;
  constructor(initial: string[] = []) {
    this.set = new Set(initial);
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
  add(name: string): void {
    this.set.add(name);
  }
  remove(name: string): void {
    this.set.delete(name);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classList: FakeClassList;
  open: boolean;
  constructor(tag: string, attributes: Record<string, string> = {}, classes: string[] = [], open = false) {
    this.tag = tag;
    this.open = open;
    this.classList = new FakeClassList(classes);
    for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value);
  }
  readonly tag: string;
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

interface FakeTree {
  root: HTMLElement;
  html: FakeElement;
  groups: Record<string, FakeElement[]>;
}

function makeTree(groups: Record<string, FakeElement[]>): FakeTree {
  const html = new FakeElement('html', {}, ['dark']);
  const doc = { documentElement: html };
  const root = {
    ownerDocument: doc,
    querySelectorAll: (selector: string) => groups[selector] ?? [],
  } as unknown as HTMLElement;
  return { root, html, groups };
}

describe('导出准备（preparePdfExport）', () => {
  it('展开全部折叠、关闭黑幕与暗色，并在还原后回到原状', () => {
    const accordionA = new FakeElement('details', { name: 'collapse-group-x' }, [], false);
    const accordionB = new FakeElement('details', { name: 'collapse-group-x' }, [], true);
    const plain = new FakeElement('details', {}, [], false);
    const sectionBody = new FakeElement('div', { hidden: '' });
    const codeBlock = new FakeElement('pre', { 'data-collapsed': 'true' });
    const { root, html, groups } = makeTree({
      details: [accordionA, accordionB, plain],
      '[data-body-heading-content][hidden]': [sectionBody],
      '[data-code-block][data-collapsed]': [codeBlock],
    });

    const prep = preparePdfExport(root);

    // 准备态：全展开 + 摘掉手风琴组名（否则同名互斥会把已展开的顶回去）
    expect(groups.details!.every((el) => el.open)).toBe(true);
    expect(accordionA.getAttribute('name')).toBeNull();
    expect(accordionB.getAttribute('name')).toBeNull();
    expect(sectionBody.hasAttribute('hidden')).toBe(false);
    expect(codeBlock.hasAttribute('data-collapsed')).toBe(false);
    expect(html.getAttribute('data-pdf-export')).toBe('on');
    expect(html.getAttribute('data-spoiler-hide')).toBe('off');
    expect(html.classList.contains('dark')).toBe(false);
    expect(prep.changed).toBe(5);

    prep.restore();

    // 还原态：open 与 name 都回到导出前（两阶段还原，避免互斥顶回）
    expect(accordionA.open).toBe(false);
    expect(accordionB.open).toBe(true);
    expect(plain.open).toBe(false);
    expect(accordionA.getAttribute('name')).toBe('collapse-group-x');
    expect(accordionB.getAttribute('name')).toBe('collapse-group-x');
    expect(sectionBody.hasAttribute('hidden')).toBe(true);
    expect(codeBlock.getAttribute('data-collapsed')).toBe('true');
    expect(html.getAttribute('data-pdf-export')).toBeNull();
    expect(html.getAttribute('data-spoiler-hide')).toBeNull();
    expect(html.classList.contains('dark')).toBe(true);
  });

  it('还原是幂等的（重复调用不会二次改写）', () => {
    const detail = new FakeElement('details', {}, [], false);
    const { root, html } = makeTree({ details: [detail] });
    const prep = preparePdfExport(root);
    prep.restore();
    prep.restore();
    expect(detail.open).toBe(false);
    expect(html.getAttribute('data-pdf-export')).toBeNull();
  });

  it('没有可展开内容时也不报错，且仍关闭黑幕', () => {
    const { root, html } = makeTree({});
    const prep = preparePdfExport(root);
    expect(prep.changed).toBe(0);
    expect(html.getAttribute('data-pdf-export')).toBe('on');
    prep.restore();
    expect(html.getAttribute('data-pdf-export')).toBeNull();
  });
});

describe('导出文件名（pdfFileName）', () => {
  it('复用 Markdown 导出的清洗规则并追加 .pdf', () => {
    expect(pdfFileName('数学讲义：极限/连续')).toBe('数学讲义：极限连续.pdf');
    expect(pdfFileName('  a b  ')).toBe('a_b.pdf');
    expect(pdfFileName('')).toBe('article.pdf');
  });
});
