/**
 * PDF 直出桥（桌面端）
 *
 * 渲染层把正文切到「纸面态」（黑幕关闭 / 折叠展开 / 浅色）后调用本 IPC，
 * 主进程用 `webContents.printToPDF` 走 Chromium 打印管线产出**矢量 PDF**
 * （文本可选中、分页遵循 print.css 的断页规则），再由保存对话框落盘。
 *
 * 与 `window.print()` 的区别：**不打开系统打印对话框**（用户报的「走了打印机页面」
 * 正是旧实现）；与浏览器端画布方案的区别：不经过位图，长文与公式更清晰。
 *
 * 安全：只服务本站窗口（trustedWindow），文件名由标题清洗后生成，
 * 落盘路径完全由用户在系统保存对话框里选择，主进程不猜测任何路径。
 */
const fs = require('node:fs');

/** 复用 Markdown 导出的 Windows 文件名清洗规则（非法字符、保留名、长度） */
function safeName(title) {
  let name = String(title ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100) || '文章';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

function installPdfExport({ ipcMain, dialog, trustedWindow }) {
  ipcMain.handle('desktop:export-pdf', async (event, input) => {
    try {
      const win = trustedWindow(event);
      if (!win) throw Error('仅桌面端本站页面可导出 PDF');
      const receiver = event.sender;
      const title = typeof input?.title === 'string' ? input.title : '';

      const picked = await dialog.showSaveDialog(win, {
        title: '导出 PDF',
        defaultPath: `${safeName(title)}.pdf`,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      if (win.isDestroyed() || receiver.isDestroyed()) throw Error('页面已关闭，请重试');

      // preferCSSPageSize：采用 print.css 的 `@page { margin: 18mm 16mm }`；
      // printBackground：代码块/提示块的底色在纸面上保留
      const data = await receiver.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        landscape: false,
      });
      fs.writeFileSync(picked.filePath, data);
      return { ok: true, filePath: picked.filePath };
    } catch (error) {
      return { ok: false, error: error?.message || 'PDF 导出失败' };
    }
  });
}

module.exports = { safeName, installPdfExport };
