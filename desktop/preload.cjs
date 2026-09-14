/**
 * 桌面端预加载脚本：刻意保持最小化
 *
 * - contextIsolation 下仅向渲染进程暴露只读元信息（版本号 / 配置目录名）；
 * - **不暴露**任何 Node / fs / IPC 写能力——桌面端的安全边界是「浏览器页面 = Web 页面」，
 *   所有数据读写都走本地服务的 HTTP API（与 Web 版同一套端点），桌面壳不参与业务。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  /** 桌面端构建版本（package.json version） */
  version: process.env.DESKTOP_VERSION ?? '',
  /** 打开配置目录（主进程弹资源管理器） */
  openConfigDir: () => ipcRenderer.invoke('desktop:open-config-dir'),
});
