/**
 * 桌面端预加载脚本：刻意保持最小化
 *
 * - contextIsolation 下只暴露版本号、固定窗口操作与工具链入口；
 * - 不暴露 Node / fs / 任意 IPC。工具链每次原生操作由主进程校验站主身份，
 *   博客内容业务仍通过本地服务的 HTTP API 读写。
 */
// ⚠️ 本文件是 .cjs，必须用 CommonJS：写成 ESM 的 import 会导致
// "Cannot use import statement outside a module"（preload 加载失败，实测踩过）。
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** 桌面端构建版本（package.json version） */
  version: process.env.DESKTOP_VERSION ?? '',
  toolchain: (action, input) => ipcRenderer.invoke('desktop:toolchain', action, input),
  pickToolchain: (kind) => ipcRenderer.invoke('desktop:toolchain-picker', kind),
  // Electron 32+ removed File.path. A renderer-created fake File resolves to no
  // path; the main process additionally verifies owner/session/type/target.
  dropToolchainSoftware: (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? ipcRenderer.invoke('desktop:toolchain', 'inspect-software', { path }) : Promise.resolve({ ok: false, error: '请从 Windows 文件资源管理器拖入实际快捷方式或程序' });
  },
  /** 打开配置目录（主进程弹资源管理器） */
  openConfigDir: () => ipcRenderer.invoke('desktop:open-config-dir'),
  /** Only a folder picker for the two registered skills; no filesystem access is exposed. */
  pickSkillDirectory: (skillId) => ['note-normalizer', 'my-blog-structured-notes'].includes(skillId)
    ? ipcRenderer.invoke('desktop:pick-skill-directory', skillId) : Promise.resolve(null),
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
