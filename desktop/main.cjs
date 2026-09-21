/**
 * 桌面端主进程（Electron，CJS —— main 入口刻意用 require('electron')，
 * 规避「pnpm 符号链接 node_modules + Electron ESM 具名导出失效」的组合坑）
 *
 * 职责（严格按此顺序）：
 *   1. 读取/生成配置（%APPDATA%/byqx-blog-desktop/config.json）
 *   2. 选空闲端口 → 注入 process.env（**必须在 import 服务产物之前**：
 *      db/index.ts 模块加载时即读取 DATABASE_URL 选方言、node 适配器读取 PORT/HOST）
 *   3. 动态 import Astro Node standalone 产物（dist/server/entry.mjs）→ 起本地服务
 *   4. 窗口加载 http://127.0.0.1:<port>；did-fail-load → 内置离线页
 *   5. 托盘（打开/退出）+ 版本检查（手动更新）
 *   6. BYQX_SMOKE=1 → 冒烟模式：服务就绪且首页 200 后打印 BYQX_SMOKE_OK 并退出
 *   7. Ctrl+N → 同进程多开窗口（共享同一本地服务/登录态；主窗口关闭→托盘，副窗口关闭即销毁）
 *
 * 安全约定：
 *   - 服务只绑定 127.0.0.1（绝不 0.0.0.0）
 *   - 配置文件含数据库凭据与站主密码，存 %APPDATA%/byqx-blog-desktop（用户级 ACL）
 *   - preload 不暴露任何 Node 能力（contextIsolation）
 */
const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, session, shell } = require('electron');
const { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync, renameSync, statSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const net = require('node:net');

/** 应用根：dev = 仓库根（desktop/..）；打包 = resources/app（desktop/..） */
const APP_ROOT = path.join(__dirname, '..');
/** 配置目录（固定名，不随 productName 变，便于文档与排障） */
const CONFIG_DIR = path.join(app.getPath('appData'), 'byqx-blog-desktop');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** 必填项：缺一则服务无法正常使用 */
const REQUIRED_KEYS = ['SYNC_DATABASE_URL', 'ADMIN_PASSWORD'];
/** 可选透传（云端对象存储 / 外挂评论 / Blob 大字体直传 / 云端同步连接串） */
const OPTIONAL_PASSTHROUGH = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  'R2_PUBLIC_BASE_URL', 'R2_S3_ENDPOINT', 'BLOB_READ_WRITE_TOKEN',
  'PUBLIC_TWIKOO_ENV_ID',
  // 同步引擎读写云端用（桌面端运行时 DATABASE_URL 指向本地 SQLite，云端另有连接串）
  'SYNC_DATABASE_URL', 'SYNC_DATABASE_URL_FALLBACK',
];

/**
 * 启动日志（"双击没反应"类问题唯一的线索来源）
 *
 * 写入 %APPDATA%\byqx-blog-desktop\logs\launch.log：记录单实例锁结果、
 * 服务就绪、窗口显示、强制显示兜底等关键节点，便于事后排障。
 */
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const LAUNCH_LOG = path.join(LOG_DIR, 'launch.log');

function logLaunch(message) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LAUNCH_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* 日志失败不影响启动 */
  }
}

/** 渲染层日志缓冲：攒批后一次落盘（避免高频 console 触发同步文件 IO） */
const rendererLogBuffer = [];
let rendererFlushTimer = null;
function scheduleRendererFlush() {
  if (rendererFlushTimer) return;
  rendererFlushTimer = setTimeout(() => {
    rendererFlushTimer = null;
    if (rendererLogBuffer.length === 0) return;
    const batch = rendererLogBuffer.splice(0);
    try {
      appendFileSync(LAUNCH_LOG, batch.join('\n') + '\n');
    } catch { /* 忽略 */ }
  }, 1000);
}

process.on('uncaughtException', (err) => {
  logLaunch(`未捕获异常：${err && err.stack ? err.stack.slice(0, 400) : err}`);
});
process.on('unhandledRejection', (reason) => {
  logLaunch(`未处理的 Promise 拒绝：${reason && reason.message ? reason.message : reason}`);
});

/** 冒烟模式：跳过单实例锁（测试实例不得占用锁，否则会让用户"双击没反应"） */
const IS_SMOKE = process.env.BYQX_SMOKE === '1';

/** 单实例锁：防止双开（端口/本地库争用）；第二实例的窗口前置由下面的 handler 处理 */
const hasLock = IS_SMOKE ? true : app.requestSingleInstanceLock();
if (!hasLock) {
  logLaunch('检测到已运行的实例：本次启动已转交（交给它前置窗口）');
  app.quit();
} else {
  logLaunch(`启动：pid=${process.pid}${IS_SMOKE ? '（冒烟模式，跳过单实例锁）' : ''}`);
}

/** 第二实例请求：把已有窗口前置（注册在模块作用域，避免启动期竞态） */
app.on('second-instance', () => {
  logLaunch('收到第二实例启动请求：前置主窗口');
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// 禁用硬件加速：博客 UI 无 GPU 增益，软件渲染在远程会话/老显卡机器上更稳
// （未禁用时 GPU process 反复崩溃会导致窗口无法绘制、自截图挂起）
app.disableHardwareAcceleration();
// ⚠️ 仅 disableHardwareAcceleration() 不够（2026-09-21 实测）：本机 Electron 44 仍会拉起
//    GPU 进程，随后以
//      ERROR:gpu_process_host.cc GPU process exited unexpectedly: exit_code=1（反复）
//      FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.
//    直接终止整个应用 —— 冒烟/无 GUI 场景表现为「服务起了、首页 200，但进程非零退出」。
//    因此在命令行层再关掉 GPU 与合成，彻底不创建 GPU 进程。
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

/** 生成随机 AUTH_SECRET（会话 Cookie 按 origin 隔离，本地无需与线上一致） */
function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** 读取配置；不存在则写模板并返回 null（调用方引导用户填写后重启） */
function loadOrCreateConfig() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    const template = {
      SYNC_DATABASE_URL: 'postgres://用户名:密码@主机:5432/库名',
      ADMIN_PASSWORD: '你的站主密码（与 Web 版一致）',
      AUTH_SECRET: randomSecret(),
      R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '',
      R2_BUCKET: '', R2_PUBLIC_BASE_URL: '', R2_S3_ENDPOINT: '',
      BLOB_READ_WRITE_TOKEN: '', PUBLIC_TWIKOO_ENV_ID: '',
      PORT: '43217',
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf8');
    return null;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** 探测端口是否空闲 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function pickPort(preferred) {
  let port = preferred;
  for (let i = 0; i < 20 && !(await isPortFree(port)); i += 1) port += 1;
  return port;
}

/** 轮询本地服务直到可访问（超时抛错） */
async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch { /* 未就绪，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`本地服务 ${timeoutMs / 1000}s 内未就绪：${url}`);
}

/** 定位模板库（多候选路径：兼容 electron-builder 打包与自制便携版两种布局） */
function templateDbPath() {
  const candidates = [
    // electron-builder 产物：extraResources 放到 resources/desktop-assets/
    path.join(process.resourcesPath || '', 'desktop-assets', 'template.db'),
    // 自制便携版/开发：项目内的 desktop/assets/
    path.join(APP_ROOT, 'desktop', 'assets', 'template.db'),
  ];
  const found = candidates.find((p) => p && existsSync(p)) || null;
  if (!found) logLaunch(`模板库缺失，候选路径：${candidates.join(' | ')}`);
  return found;
}

/**
 * 本地库健康检查（PRAGMA quick_check）
 *
 * 为什么需要：SQLite 库与它的 `-wal` / `-shm` 是一体的。实测踩坑——
 * 单独替换 `blog-local.db` 而留下旧 `-wal` 会导致
 * `database disk image is malformed`，页面全部 500，用户看到的是"应用坏了"。
 */
function isLocalDbHealthy(localDbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(localDbPath, { readonly: true });
    const row = db.prepare('PRAGMA quick_check').get();
    db.close();
    const ok = row && Object.values(row)[0] === 'ok';
    if (!ok) logLaunch(`本地库 quick_check 异常：${JSON.stringify(row)}`);
    return !!ok;
  } catch (err) {
    logLaunch(`本地库不可用（${err && err.message ? err.message : err}）：将备份并重建`);
    return false;
  }
}

/** 把本地库及其 -wal / -shm 一起移走（SQLite 三者必须同进同出） */
function quarantineLocalDb(localDbPath) {
  const stamp = Date.now();
  for (const suffix of ['', '-wal', '-shm']) {
    const from = localDbPath + suffix;
    if (!existsSync(from)) continue;
    try {
      renameSync(from, `${localDbPath}.bad-${stamp}${suffix}`);
    } catch (err) {
      logLaunch(`移走 ${path.basename(from)} 失败：${err && err.message ? err.message : err}`);
    }
  }
}

/**
 * 确保本地库可用：缺失 → 用模板创建；损坏 → 备份重建
 *
 * 重建后的库是空的，用户下次同步会重新拉全量（本地优先架构下这是可接受的恢复路径）。
 */
function ensureLocalDb(localDbPath) {
  mkdirSync(path.dirname(localDbPath), { recursive: true });
  const tpl = templateDbPath();

  if (existsSync(localDbPath) && isLocalDbHealthy(localDbPath)) return;

  if (existsSync(localDbPath)) {
    quarantineLocalDb(localDbPath); // 损坏：留档后重建，绝不让应用变砖
    logLaunch('本地库已隔离重建（原文件保留为 .bad-<时间戳>）');
  }
  if (tpl) copyFileSync(tpl, localDbPath);
  else logLaunch('未找到模板库，本地库将由服务端首次迁移创建');
}

let mainWindow = null;
let tray = null;
/** 本地服务端口（托盘/启动拉取调用本地 API 用） */
let currentPort = 0;
/** 本地服务根址（Ctrl+N 新开窗口用；main() 起服务后赋值） */
let siteBaseUrl = '';
/** 应用窗口集合（Ctrl+N 多开）：主窗口关闭→隐藏到托盘，副窗口关闭即销毁 */
const appWindows = new Set();

const OFFLINE_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>离线</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#faf9f5;font-family:'Microsoft YaHei',sans-serif;color:#2c2c2a;">
  <div style="text-align:center">
    <p style="font-size:56px;margin:0 0 12px">🖥️</p>
    <h1 style="font-size:28px;margin:0 0 10px;">无法连接本地服务</h1>
    <p style="color:#8a867e">请点击「重新加载」稍作等待；若持续失败，请重启应用。</p>
    <button onclick="location.reload()" style="margin-top:18px;padding:8px 22px;font-size:15px;cursor:pointer;">重新加载</button>
  </div>
</body>`)}`;

function createWindow(url, { primary = false } = {}) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: '白衣卿相',
    autoHideMenuBar: true,
    backgroundColor: '#faf9f5',
    // 直接显示：不依赖 ready-to-show（实测在无 GPU/远程会话下该事件可能不触发，
    // 表现为"进程活着但窗口永不出现"= 用户眼里的"双击没反应"）
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  appWindows.add(win);
  win.loadURL(url).catch(() => win.loadURL(OFFLINE_HTML));
  win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) win.loadURL(OFFLINE_HTML).catch(() => {});
  });
  win.once('ready-to-show', () => {
    if (!win.isVisible()) win.show();
  });
  win.webContents.on('did-finish-load', () => {
    logLaunch('页面加载完成');
    if (!win.isVisible()) win.show();
  });
  // 渲染进程 → 主进程日志转发：**所有窗口**统一转发（副窗口里的报错同样必须可见）
  win.webContents.on('console-message', (...args) => {
    // Electron 44：新签名为 (event, details)，旧签名为 (event, level, message)
    const details = args[1] && typeof args[1] === 'object' ? args[1] : null;
    const message = details ? String(details.message ?? '') : String(args[2] ?? '');
    const level = details ? Number(details.level ?? 0) : Number(args[1] ?? 0);
    if (!message) return;
    if (message.startsWith('[motion]') || level >= 3) {
      // 批量写入：渲染层高频 console（KaTeX preload 警告等）逐条同步追加文件会造成 IO 卡顿
      rendererLogBuffer.push(`[renderer] ${message.slice(0, 300)}`);
      scheduleRendererFlush();
    }
  });
  // Ctrl+N → 新开窗口（主进程拦截，不依赖页面 JS；编辑器/输入法场景同样生效）。
  // 与浏览器语义一致：同进程内新开窗口，共享同一本地服务与登录态。
  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      !input.alt && !input.shift &&
      (input.control || input.meta) &&
      String(input.key).toLowerCase() === 'n'
    ) {
      event.preventDefault();
      openExtraWindow();
    }
  });
  // 关闭语义：主窗口 → 隐藏到托盘（托盘「退出」才真正退出）；
  // 副窗口（Ctrl+N 多开）→ 直接销毁，避免隐藏窗口堆积占内存。
  win.on('close', (e) => {
    if (globalThis.__quitting !== true && primary) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => appWindows.delete(win));
  return win;
}

/** Ctrl+N：新开副窗口（同一本地服务 → 登录态/数据与主窗口完全一致，无端口与数据库争用） */
function openExtraWindow() {
  if (!siteBaseUrl) return null;
  const win = createWindow(`${siteBaseUrl}/`, { primary: false });
  logLaunch(`Ctrl+N 新开窗口（当前共 ${appWindows.size} 个）`);
  return win;
}

function createTray(win) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'desktop-assets', 'tray-icon.png')
    : path.join(APP_ROOT, 'desktop', 'tray-icon.png');
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('白衣卿相 · 桌面端');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { win.show(); win.focus(); } },
    { label: '立即同步', click: () => void interactiveSync() },
    { type: 'separator' },
    { label: '退出', click: () => { globalThis.__quitting = true; app.quit(); } },
  ]));
}

/** 版本检查（手动更新）：与 Web 端 desktop-version.json 比对，落后则弹窗引导 */
async function checkVersion() {
  const online = process.env.PUBLIC_SITE_URL_OVERRIDE || 'https://www.byqx-blog.online';
  try {
    const res = await fetch(`${online}/desktop-version.json`, { signal: AbortSignal.timeout(8000) });
    const meta = await res.json();
    const local = app.getVersion();
    if (meta.version && meta.version !== local) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '有新版本',
        message: `桌面端 ${local} → 最新 ${meta.version}`,
        detail: '本次为手动更新：请到下载页获取新版安装包覆盖安装。',
        buttons: ['打开下载页', '稍后再说'],
      });
      if (response === 0) await shell.openExternal(meta.url || online);
    }
  } catch { /* 无网络/无清单：静默跳过 */ }
}

/**
 * 读取本地会话 Cookie
 *
 * 同步端点受 `guardManager` 保护（同 Web 端权限体系），主进程 fetch 不会自动带 Cookie，
 * 需要显式从 Electron 会话里取出管理端会话拼到请求头。
 */
async function localCookieHeader() {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: `http://127.0.0.1:${currentPort}` });
    const wanted = cookies.filter((c) => c.name === 'admin_session' || c.name === 'top_admin_session');
    return wanted.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/**
 * 触发同步（POST 本地 API，非阻塞）
 *
 * ⚠️ 必须带同源 `Origin` 头：Astro 默认开启 CSRF 校验（checkOrigin），
 * 对 POST 会比对 Origin 与 Host；主进程的 fetch 默认不带 Origin，
 * 会被判为跨站并返回 403「Cross-site POST form submissions are forbidden」
 * （实测踩坑：启动同步静默失败、文章一直为空）。
 */
async function triggerSync() {
  const cookie = await localCookieHeader();
  const origin = `http://127.0.0.1:${currentPort}`;
  const res = await fetch(`${origin}/api/desktop/sync`, {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      origin,
      referer: `${origin}/admin/settings/sync`,
    },
  });
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    /* 忽略 */
  }
  logLaunch(`POST /api/desktop/sync → HTTP ${res.status}${body ? ` body=${body}` : ''}｜cookie=${cookie ? '有' : '无'}`);
  if (res.status === 401) throw new Error('未登录：请先在应用窗口内登录管理端，再执行同步');
  return res.status === 202 || res.ok;
}

/** 轮询同步状态直到结束（返回最终状态） */
async function waitForSyncDone(timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookie = await localCookieHeader();
    const res = await fetch(`http://127.0.0.1:${currentPort}/api/desktop/sync`, {
      headers: cookie ? { cookie } : {},
    });
    if (res.ok) {
      const s = await res.json();
      if (!s.running) {
        logLaunch(
          `同步状态：running=false｜cloudConfigured=${s.cloudConfigured}｜lastError=${s.lastError ?? 'null'}｜有报告=${s.lastReport ? '是' : '否'}`,
        );
        return s;
      }
      try {
        if (tray && !tray.isDestroyed() && s.progress) {
          tray.setToolTip(`白衣卿相 · 同步中 ${s.progress.table}（${s.progress.index + 1}/${s.progress.total}）`);
        }
      } catch {
        /* 托盘已销毁（应用退出中）：忽略 */
      }
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('同步超时（10 分钟）');
}

/** 把报告压成可读摘要（只列有动作的表） */
function summarizeReport(report) {
  if (!report) return '无报告';
  const rows = (report.perTable || []).filter(
    (t) => t.pushed || t.pulled || t.deletedLocal || t.deletedRemote || t.conflicts || t.skipped,
  );
  if (rows.length === 0) return '无变更：本地与云端已一致。';
  return rows
    .slice(0, 12)
    .map(
      (t) =>
        `· ${t.table}：推送 ${t.pushed}｜拉取 ${t.pulled}｜本地删 ${t.deletedLocal}｜云端删 ${t.deletedRemote}｜冲突 ${t.conflicts}` +
        (t.skipped ? `（跳过：${t.skipped}）` : ''),
    )
    .join('\n');
}

/** 托盘菜单：交互式同步（带结果弹窗） */
async function interactiveSync() {
  try {
    try { tray?.setToolTip('白衣卿相 · 正在同步…'); } catch { /* 忽略 */ }
    await triggerSync();
    const state = await waitForSyncDone();
    try { tray?.setToolTip('白衣卿相 · 桌面端'); } catch { /* 忽略 */ }
    if (state.lastError) {
      dialog.showErrorBox('同步失败', state.lastError);
      return;
    }
    const warnings = (state.lastReport?.warnings || []).join('\n');
    dialog.showMessageBox({
      type: 'info',
      title: '同步完成',
      message: `同步完成（耗时 ${Math.round(((state.lastReport?.finishedAt ?? 0) - (state.lastReport?.startedAt ?? 0)) / 1000)}s）`,
      detail: summarizeReport(state.lastReport) + (warnings ? `

提示：${warnings}` : ''),
    });
  } catch (err) {
    try { tray?.setToolTip('白衣卿相 · 桌面端'); } catch { /* 忽略 */ }
    dialog.showErrorBox('同步失败', String(err && err.message ? err.message : err));
  }
}

/**
 * R2 对象请求拦截（W6 按需下载）
 *
 * 桌面端不改渲染、Web 端零感知的做法：
 *   - 命中本地缓存 → 把请求重定向到本地对象路由（离线也能显示）；
 *   - 未命中 → 放行原请求（在线正常显示），同时后台请求一次本地路由把它缓存下来。
 *
 * 为什么在 Electron 层拦截而不是改渲染：页面里的图片 URL 仍是 R2 公网地址，
 * 由壳负责"本地优先"，这样 Web 与桌面端共用同一份渲染代码。
 */
const inflightCache = new Set();

function setupObjectInterceptor(r2PublicBaseUrl) {
  const base = String(r2PublicBaseUrl || '').replace(/\/+$/, '');
  if (!base) {
    logLaunch('未配置 R2_PUBLIC_BASE_URL：跳过对象拦截（图片直接走云端）');
    return;
  }
  const filesDir = path.join(CONFIG_DIR, 'files');
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: [`${base}/*`] }, (details, callback) => {
      try {
        const key = decodeURIComponent(new URL(details.url).pathname.replace(/^\/+/, ''));
        if (!key) {
          callback({});
          return;
        }
        const localPath = path.join(filesDir, key.replace(/\.\./g, '_'));
        if (existsSync(localPath)) {
          callback({ redirectURL: `http://127.0.0.1:${currentPort}/api/desktop/object/${key}` });
          return;
        }
        // 未命中：放行 + 后台缓存（去重，避免同一对象并发多次下载）
        if (!inflightCache.has(key)) {
          inflightCache.add(key);
          void fetch(`http://127.0.0.1:${currentPort}/api/desktop/object/${key}`)
            .catch(() => {})
            .finally(() => inflightCache.delete(key));
        }
      } catch (err) {
        logLaunch(`对象拦截异常（已放行原请求）：${err && err.message ? err.message : err}`);
      }
      callback({});
    });
    logLaunch(`已启用对象拦截：${base}/* → 本地缓存优先`);
  } catch (err) {
    logLaunch(`注册对象拦截失败（图片仍可直连云端）：${err && err.message ? err.message : err}`);
  }
}

/** 启动时静默拉取一次（未登录则跳过，不打扰用户） */
async function silentStartupSync() {
  try {
    const cookie = await localCookieHeader();
    if (!cookie) {
      logLaunch('启动同步跳过：尚未登录管理端（登录后可手动或自动同步）');
      return;
    }
    await triggerSync();
    const state = await waitForSyncDone();
    // 把结果写进启动日志：失败原因必须可见（否则用户只看到"没数据"）
    if (state.lastError) {
      logLaunch(`启动同步失败：${state.lastError}`);
    } else if (state.lastReport) {
      const pulled = state.lastReport.perTable.reduce((n, t) => n + t.pulled, 0);
      const pushed = state.lastReport.perTable.reduce((n, t) => n + t.pushed, 0);
      const skipped = state.lastReport.perTable.filter((t) => t.skipped).length;
      logLaunch(`启动同步完成：拉取 ${pulled} 行，推送 ${pushed} 行，跳过 ${skipped} 表`);
      if (state.lastReport.warnings?.length) {
        logLaunch(`同步警告：${state.lastReport.warnings.slice(0, 2).join(' | ').slice(0, 300)}`);
      }
    } else {
      logLaunch('启动同步：无报告（未执行？）');
    }
    // 用户可见的反馈：无数据 + 不出结果时不能静默
    if (!state.lastReport && !state.lastError) {
      dialog.showMessageBox({
        type: 'warning',
        title: '云端同步未执行',
        message: '本地库目前是空的，而启动同步没有返回结果。',
        detail: `请先确认：\n1) 已用站主密码登录（设置页 → 云端同步 也会显示状态）\n2）配置文件里的 SYNC_DATABASE_URL 可用\n\n配置文件：${CONFIG_FILE}\n启动日志：${path.join(CONFIG_DIR, 'logs', 'launch.log')}`,
      });
    } else if (state.lastError) {
      dialog.showMessageBox({
        type: 'warning',
        title: '云端同步失败',
        message: state.lastError,
        detail: `本地浏览不受影响；修复后可在「设置 → 云端同步」或托盘菜单重试。\n配置：${CONFIG_FILE}`,
      });
    }
  } catch (err) {
    logLaunch(`启动同步异常：${err && err.message ? err.message : err}`);
  }
}

async function main() {
  // ⚠️ 必须先等 app ready：`session.defaultSession`（对象拦截）与 `BrowserWindow`
  //    都要求 ready 之后才可用。此前 main() 在模块加载时即执行，在启动极快或
  //    服务产物 import 很快的机器上，对象拦截会静默注册失败（图片缓存能力失效）。
  await app.whenReady();

  const smoke = process.env.BYQX_SMOKE === '1';
  const capturePath = process.env.BYQX_CAPTURE || '';
  const startPath = process.env.BYQX_START_PATH || '/';
  process.env.DESKTOP_VERSION = app.getVersion();

  const cfg = loadOrCreateConfig();
  if (!cfg) {
    if (smoke) {
      console.log('BYQX_SMOKE_WARN config-missing');
    } else {
      dialog.showErrorBox(
        '首次使用：请先填写配置',
        `已生成配置模板：\n${CONFIG_FILE}\n\n至少填写 SYNC_DATABASE_URL（云端 PostgreSQL 连接串）与 ADMIN_PASSWORD（站主密码），保存后重启应用。`,
      );
      shell.showItemInFolder(CONFIG_FILE);
      app.quit();
      // ⚠️ 必须 return：否则会带着空配置继续往下走（再弹一个「缺少必填配置」，
      //    并尝试用空 DATABASE_URL / ADMIN_PASSWORD 起服务，报出误导性错误）
      return;
    }
  }
  const config = cfg ?? {};

  const missing = REQUIRED_KEYS.filter((k) => !config[k]);
  if (missing.length > 0 && !smoke) {
    dialog.showErrorBox('缺少必填配置', `config.json 缺少：${missing.join(', ')}\n文件位置：${CONFIG_FILE}`);
  }

  const port = await pickPort(Number(config.PORT) || 43217);
  currentPort = port;
  setupObjectInterceptor(config.R2_PUBLIC_BASE_URL);
  const localDbPath = config.LOCAL_DB_PATH || path.join(CONFIG_DIR, 'blog-local.db');
  ensureLocalDb(localDbPath);

  // ---- env 注入（必须先于 import 服务产物：db/index.ts 在模块加载时读方言） ----
  process.env.DATABASE_URL = `file:${localDbPath}`;
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.PUBLIC_SITE_URL = `http://127.0.0.1:${port}`;
  process.env.AUTH_SECRET = config.AUTH_SECRET || randomSecret();
  process.env.ADMIN_PASSWORD = config.ADMIN_PASSWORD ?? '';
  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  // 桌面端标记：设置页据此显示「云端同步」分区（Web 端不显示）
  process.env.DESKTOP_MODE = '1';
  for (const key of OPTIONAL_PASSTHROUGH) {
    if (config[key]) process.env[key] = config[key];
  }
  if (!app.isPackaged) process.chdir(APP_ROOT);

  // ---- 起 Astro Node standalone 服务（产物为 ESM → CJS 内用动态 import；
  //      ⚠️ Windows 绝对路径必须经 pathToFileURL 转 file:// 否则 ESM 报 c: 协议错误） ----
  const entryPath = path.join(APP_ROOT, 'dist', 'server', 'entry.mjs');
  if (!existsSync(entryPath)) {
    dialog.showErrorBox('缺少服务产物', `未找到 ${entryPath}\n请先执行 pnpm run build:desktop`);
    app.quit();
    return;
  }
  // 半成品构建检测：entry.mjs 在、但 chunks 目录为空 → 服务端一 import 就会崩，
  // 表现为"双击没反应"（实测踩过：构建被中断后 dist 处于这种状态）。
  try {
    const chunksDir = path.join(APP_ROOT, 'dist', 'server', 'chunks');
    const chunkCount = existsSync(chunksDir) ? readdirSync(chunksDir).length : 0;
    if (chunkCount === 0) {
      logLaunch('检测到不完整的构建产物（dist/server/chunks 为空）');
      dialog.showErrorBox(
        '构建产物不完整',
        'dist/server/chunks 为空，说明上次构建被中断。\n请重新执行：pnpm run build:desktop',
      );
      app.quit();
      return;
    }
  } catch {
    /* 检查失败不阻断启动 */
  }
  await import(pathToFileURL(entryPath).href);
  const siteUrl = `http://127.0.0.1:${port}`;
  siteBaseUrl = siteUrl; // Ctrl+N 新开窗口用
  await waitForServer(siteUrl);
  logLaunch(`本地服务就绪：${siteUrl}`);
  // 记录本次运行的服务端 bundle 构建时间 —— 排查"改完没生效"时一眼看出跑的是哪版
  try {
    const entry = path.join(APP_ROOT, 'dist', 'server', 'entry.mjs');
    if (existsSync(entry)) {
      logLaunch(`服务端 bundle 构建于：${new Date(statSync(entry).mtimeMs).toLocaleString('zh-CN')}`);
    }
  } catch {
    /* 忽略 */
  }

  // ---- 冒烟模式：首页 200 即成功退出（go/no-go 验证用） ----
  if (smoke) {
    const res = await fetch(siteUrl, { signal: AbortSignal.timeout(15000) });
    const line = `BYQX_SMOKE_OK status=${res.status} url=${siteUrl}`;
    console.log(line);
    // GUI 应用的 stdout 可能被 app.exit 截断（缓冲未 flush）→ 同时落文件，并留 300ms
    if (process.env.BYQX_SMOKE_OUT) writeFileSync(process.env.BYQX_SMOKE_OUT, line);
    // 看门狗：即使 Electron 内部清理（GPU/渲染线程）出问题，也保证以正确码退出
    const code = res.ok ? 0 : 1;
    setTimeout(() => process.exit(code), 2500);
    await new Promise((r) => setTimeout(r, 300));
    app.exit(code);
    return;
  }

  // ---- 窗口 / 托盘 / 版本检查 ----
  mainWindow = createWindow(siteUrl + startPath, { primary: true });
  createTray(mainWindow);
  // 渲染层 console 转发已移入 createWindow（Ctrl+N 多开后所有窗口统一生效）

  mainWindow.once('ready-to-show', () => logLaunch('窗口已显示'));
  // 兜底：10s 内窗口仍未可见（例如页面加载异常导致 ready-to-show 未触发）→ 强制显示
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        logLaunch('窗口超时未显示：强制 show()');
        mainWindow.show();
      }
    } catch (err) {
      logLaunch(`窗口兜底检查失败（忽略）：${err && err.message ? err.message : err}`);
    }
  }, 10000);
  app.on('activate', () => mainWindow?.show());
  app.on('before-quit', () => { globalThis.__quitting = true; });

  // ---- 自截图验收模式：BYQX_CAPTURE=<png路径> → 渲染完成后截屏并退出 ----
  if (capturePath) {
    await new Promise((r) => setTimeout(r, 3500)); // 等字体/图片/入场动画
    const image = await mainWindow.webContents.capturePage();
    writeFileSync(capturePath, image.toPNG());
    console.log(`BYQX_CAPTURE_OK ${capturePath}`);
    app.exit(0);
    return;
  }

  void checkVersion();
  // 启动后静默拉取一次云端变更（本地优先下这是"看到 Web 端新评论"的来源）
  setTimeout(() => void silentStartupSync(), 3000);
}

app.on('window-all-closed', () => { /* 托盘常驻：不自动退出 */ });
void main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  logLaunch(`启动失败：${msg}`);
  dialog.showErrorBox('启动失败', `${msg}\n\n日志：${path.join(CONFIG_DIR, 'logs', 'launch.log')}`);
  app.quit();
});
