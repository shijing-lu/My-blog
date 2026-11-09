/**
 * 「导出 PDF」编排层（文档文章 / 首页文章 / 文章编辑页共用）
 *
 * ## 交互契约
 * 点击「导出 PDF」→ **直接产出文件**，不经系统打印对话框（用户报的正是「走了打印机页面」）。
 *
 * 两条实现路径，按运行环境自动选择：
 * 1. **桌面端**（Electron）：`window.desktop.exportPdf` → 主进程 `webContents.printToPDF`
 *    （矢量 PDF、文本可选中、Chromium 原生分页）+ 保存对话框；
 * 2. **浏览器**：动态加载 `pdf-export-raster`（html2canvas-pro + jsPDF）离屏画布出图，
 *    直接触发下载；依赖较大故**按需加载**，不进首屏包。
 *
 * 导出前统一调用 `preparePdfExport`：黑幕关闭、折叠全展开、切浅色、隐藏交互件；
 * 导出结束（含失败/取消）在 `finally` 里还原页面，用户无感知。
 */
import { preparePdfExport, waitForExportAssets } from './pdf-export-prep';

export type PdfExportMode = 'desktop' | 'browser';

export interface PdfExportResult {
  ok: boolean;
  /** 用户在保存对话框里点了取消（不是错误，不再提示） */
  canceled?: boolean;
  mode?: PdfExportMode;
  error?: string;
}

export interface PdfExportOptions {
  /** 文章标题（缺省从页面 h1 解析）；同时作为 PDF 文件名 */
  title?: string;
  /** 正文根节点（缺省 `main article.prose`） */
  root?: HTMLElement | null;
  /** 进度回调（按钮文案用） */
  onStatus?: (message: string) => void;
}

/** 当前页面的正文根节点（文档页 / 首页文章页 / 文章编辑页都命中） */
export function resolveExportRoot(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('main article.prose') ??
    document.querySelector<HTMLElement>('article.prose')
  );
}

/** 解析文章标题：优先正文区 h1（文档页切换文章后 h1 会更新），回落站点标题 */
export function resolveExportTitle(menu?: HTMLElement | null): string {
  const scope: ParentNode = menu?.closest('main') ?? document;
  const heading = scope.querySelector('h1')?.textContent?.trim() ?? '';
  if (heading) return heading;
  return document.title.replace(/\s*[·|｜-]\s*.*$/, '').trim() || '文章';
}

/** 页眉副标题：站点名 + 导出时间 + 来源地址 */
function exportSubtitle(): string {
  const siteName = document.title.split(/[·|｜]/)[0]?.trim();
  return [
    siteName || '白衣卿相',
    `导出时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    location.origin + location.pathname,
  ].join(' · ');
}

/** 就地编辑器正在编辑时先保存并回到阅读态：否则导出的会是编辑器界面或旧内容 */
async function settleInlineEditor(status: (message: string) => void): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.__docInlineEditor;
  if (!bridge) return { ok: true };
  status('正在保存正文…');
  if (bridge.flush) {
    try {
      if ((await bridge.flush()) === false) return { ok: false, error: '保存失败，请先处理当前改动再导出' };
    } catch {
      return { ok: false, error: '保存失败，请先处理当前改动再导出' };
    }
  }
  if (bridge.getMode && bridge.switchMode && bridge.getMode() !== 'preview') {
    try {
      if ((await bridge.switchMode('preview')) === false) {
        return { ok: false, error: '请先完成文章保存，再导出 PDF' };
      }
    } catch {
      return { ok: false, error: '请先退出编辑再导出 PDF' };
    }
    // 退出编辑态是 React 状态更新：等两帧再取正文节点
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
  return { ok: true };
}

/**
 * 导出当前文章为 PDF 并直接下载 / 保存。
 * 失败一律返回结构化的 `{ ok:false, error }`，不向调用方抛错。
 */
export async function exportArticlePdf(options: PdfExportOptions = {}): Promise<PdfExportResult> {
  const status = options.onStatus ?? ((): void => {});

  const editor = await settleInlineEditor(status);
  if (!editor.ok) return { ok: false, error: editor.error };

  const root = options.root ?? resolveExportRoot();
  if (!root) return { ok: false, error: '未找到可导出的正文，请刷新页面后重试' };
  if (root.hasAttribute('data-defer-article')) {
    return { ok: false, error: '正文尚在加载，请稍候再导出' };
  }
  const title = (options.title ?? resolveExportTitle()).trim() || '文章';

  const prep = preparePdfExport(root);
  try {
    await waitForExportAssets(root);

    const bridge = window.desktop?.exportPdf;
    if (typeof bridge === 'function') {
      status('正在生成 PDF…');
      const result = await bridge({ title });
      if (result?.canceled) return { ok: false, canceled: true, mode: 'desktop' };
      if (result?.ok) return { ok: true, mode: 'desktop' };
      return { ok: false, error: result?.error || 'PDF 生成失败', mode: 'desktop' };
    }

    let exportPdfRaster: typeof import('./pdf-export-raster').exportPdfRaster;
    try {
      ({ exportPdfRaster } = await import('./pdf-export-raster'));
    } catch {
      return { ok: false, error: '导出组件加载失败，请检查网络后刷新页面重试' };
    }
    await exportPdfRaster({ root, title, subtitle: exportSubtitle(), onStatus: status });
    return { ok: true, mode: 'browser' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'PDF 导出失败' };
  } finally {
    prep.restore();
  }
}
