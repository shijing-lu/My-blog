/**
 * 桌面端预加载脚本：刻意保持最小化
 *
 * - contextIsolation 下只暴露版本号、固定的窗口操作与导航方法；
 * - **不暴露**任何 Node / fs / 任意 IPC 写能力。所有业务数据读写仍走本地服务的 HTTP API，
 *   桌面壳不参与业务。
 */
// ⚠️ 本文件是 .cjs，必须用 CommonJS：写成 ESM 的 import 会导致
// "Cannot use import statement outside a module"（preload 加载失败，实测踩过）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** 桌面端构建版本（package.json version） */
  version: process.env.DESKTOP_VERSION ?? '',
  /** 打开配置目录（主进程弹资源管理器） */
  openConfigDir: () => ipcRenderer.invoke('desktop:open-config-dir'),
  /** 当前窗口的站内历史导航；页面无法指定其他窗口或任意 IPC 通道。 */
  goBack: () => ipcRenderer.invoke('desktop:navigation-back'),
  goForward: () => ipcRenderer.invoke('desktop:navigation-forward'),
  getNavigationState: () => ipcRenderer.invoke('desktop:navigation-state'),
  onNavigationStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback({
      canGoBack: state?.canGoBack === true,
      canGoForward: state?.canGoForward === true,
    });
    ipcRenderer.on('desktop:navigation-state', listener);
    return () => ipcRenderer.removeListener('desktop:navigation-state', listener);
  },
});
