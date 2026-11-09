/**
 * 「导出 PDF」正文准备（浏览器端与桌面端共用）
 *
 * 导出前必须把页面从「阅读态」临时切成「纸面态」，否则导出件会丢内容或面目全非：
 *
 * 1. **黑幕关闭**：`:spoiler[...]` 的遮罩态（`html[data-spoiler-hide='on']`）在静态文件里
 *    没有点击揭示的可能，导出时必须完整显示正文；
 * 2. **折叠全部展开**：`<details>`（Callout `-` 折叠卡、`:::collapse` 折叠面板）默认收起的
 *    正文在打印/截图里**整块丢失**；手风琴组的 `name` 属性会让「程序化展开」互相顶掉，
 *    所以展开的同时必须摘掉 `name`；
 * 3. **章节折叠 / 代码块折叠**：正文标题折叠（`[data-body-heading-content][hidden]`）与
 *    代码块收起（`[data-code-block][data-collapsed]`）同样要还原；
 * 4. **浅色主题**：导出件是白纸，暗色主题费墨且对比反常（`print.css` 只在 `@media print`
 *    里强制浅色，截图路径拿不到，故这里直接摘掉 `.dark`）；
 * 5. **交互件隐藏**：`html[data-pdf-export='on']` 是给 CSS 的钩子，
 *    复制/折叠/打印等按钮在该态下 `display:none`（见 styles/print.css）。
 *
 * 所有改动都被 `restore()` 精确还原（成功、失败、取消都要调用），互不残留。
 */
import { sanitizeFilename } from './export';

export interface PdfExportPrep {
  /** 已改动元素计数（诊断日志用） */
  changed: number;
  /** 还原到导出前状态（幂等，可重复调用） */
  restore: () => void;
}

/** 从标题生成导出文件名（复用 Markdown 导出的清洗规则，保持命名一致） */
export function pdfFileName(title: string): string {
  return `${sanitizeFilename(title, 'article')}.pdf`;
}

/**
 * 把页面切到「纸面态」。
 *
 * @param root 正文根节点（`main article.prose`）；折叠态只在该子树内处理，
 *             不会误改左栏目录树等站内其它 `<details>`。
 */
export function preparePdfExport(root: HTMLElement): PdfExportPrep {
  const doc = root.ownerDocument;
  const html = doc.documentElement;
  const restores: Array<() => void> = [];
  let changed = 0;

  /* ① 全局：导出标记 + 浅色 + 黑幕关闭 */
  const prevPdfExport = html.getAttribute('data-pdf-export');
  const prevTheme = html.getAttribute('data-theme');
  const prevSpoilerHide = html.getAttribute('data-spoiler-hide');
  const hadDark = html.classList.contains('dark');
  html.setAttribute('data-pdf-export', 'on');
  html.removeAttribute('data-theme');
  html.classList.remove('dark');
  html.setAttribute('data-spoiler-hide', 'off');
  restores.push(() => {
    if (prevPdfExport === null) html.removeAttribute('data-pdf-export');
    else html.setAttribute('data-pdf-export', prevPdfExport);
    if (prevTheme === null) html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', prevTheme);
    html.classList.toggle('dark', hadDark);
    if (prevSpoilerHide === null) html.removeAttribute('data-spoiler-hide');
    else html.setAttribute('data-spoiler-hide', prevSpoilerHide);
  });

  /* ② 折叠面板 / 折叠引用块：全展开并摘掉手风琴组名 */
  const details = Array.from(root.querySelectorAll<HTMLDetailsElement>('details'));
  if (details.length > 0) {
    const saved = details.map((el) => ({ el, open: el.open, name: el.getAttribute('name') }));
    for (const { el } of saved) {
      el.open = true;
      el.removeAttribute('name');
    }
    restores.push(() => {
      // 两阶段还原：先把 name 全放回去，再回写各面板的 open。
      // 若边放 name 边写 open，同名互斥会中途把本应展开的面板顶回去（顺序敏感）。
      for (const item of saved) if (item.name !== null) item.el.setAttribute('name', item.name);
      for (const item of saved) item.el.open = item.open;
    });
    changed += saved.length;
  }

  /* ③ 标题章节折叠（H1–H6）：展开被 hidden 的正文块 */
  const foldedSections = Array.from(
    root.querySelectorAll<HTMLElement>('[data-body-heading-content][hidden]'),
  );
  if (foldedSections.length > 0) {
    for (const body of foldedSections) body.removeAttribute('hidden');
    restores.push(() => {
      for (const body of foldedSections) body.setAttribute('hidden', '');
    });
    changed += foldedSections.length;
  }

  /* ④ 代码块折叠：去掉 data-collapsed（CSS 据此隐藏代码正文） */
  const collapsedCode = Array.from(
    root.querySelectorAll<HTMLElement>('[data-code-block][data-collapsed]'),
  );
  if (collapsedCode.length > 0) {
    const savedValues = collapsedCode.map((el) => el.getAttribute('data-collapsed'));
    for (const block of collapsedCode) block.removeAttribute('data-collapsed');
    restores.push(() => {
      collapsedCode.forEach((block, index) => {
        const value = savedValues[index];
        if (value !== null && value !== undefined) block.setAttribute('data-collapsed', value);
      });
    });
    changed += collapsedCode.length;
  }

  let restored = false;
  return {
    changed,
    restore: () => {
      if (restored) return;
      restored = true;
      // 逆序还原（③④ 是纯属性；②① 的自定义顺序已在各自闭包里保证）
      for (let i = restores.length - 1; i >= 0; i -= 1) restores[i]!();
    },
  };
}

/** 等待正文里的图片与字体就绪（超时也不阻塞导出，缺图总比卡死好） */
export async function waitForExportAssets(root: HTMLElement, timeoutMs = 10_000): Promise<void> {
  const doc = root.ownerDocument;
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = (): void => {
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
            resolve();
          };
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          doc.defaultView?.setTimeout(done, timeoutMs);
        }),
    ),
  );
  try {
    await doc.fonts?.ready;
  } catch {
    /* 字体接口不可用（旧内核）时无需等待 */
  }
}
