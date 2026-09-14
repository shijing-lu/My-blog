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
 *
 * 安全约定：
 *   - 服务只绑定 127.0.0.1（绝不 0.0.0.0）
 *   - 配置文件含数据库凭据与站主密码，存 %APPDATA%/byqx-blog-desktop（用户级 ACL）
 *   - preload 不暴露任何 Node 能力（contextIsolation）
 */
const { app, BrowserWindow, Tray, Menu, dialog, nativeImage } = require('electron');
const { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs');
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
/** 可选透传（云端对象存储 / 外挂评论 / Blob 大字体直传） */
const OPTIONAL_PASSTHROUGH = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  'R2_PUBLIC_BASE_URL', 'R2_S3_ENDPOINT', 'BLOB_READ_WRITE_TOKEN',
  'PUBLIC_TWIKOO_ENV_ID',
];

/** 单实例锁：防止双开（端口/本地库争用） */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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

/** 本地库模板：缺失时从应用资源复制（打包=desktop-assets；dev=desktop/assets） */
function ensureLocalDb(localDbPath) {
  if (existsSync(localDbPath)) return;
  mkdirSync(path.dirname(localDbPath), { recursive: true });
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'desktop-assets', 'template.db')]
    : [path.join(APP_ROOT, 'desktop', 'assets', 'template.db')];
  const tpl = candidates.find((p) => existsSync(p));
  if (tpl) copyFileSync(tpl, localDbPath);
}

let mainWindow = null;
let tray = null;

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

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: '白衣卿相',
    autoHideMenuBar: true,
    backgroundColor: '#faf9f5',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(url).catch(() => win.loadURL(OFFLINE_HTML));
  win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) win.loadURL(OFFLINE_HTML).catch(() => {});
  });
  win.once('ready-to-show', () => win.show());
  // 关闭 → 隐藏到托盘；托盘退出才真正退出
  win.on('close', (e) => {
    if (globalThis.__quitting !== true) {
      e.preventDefault();
      win.hide();
    }
  });
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
    { label: '同步（D4 里程碑接入）', enabled: false },
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

/** 占位：同步引擎接入后的入口（D4 里程碑——由托盘触发） */
async function runSync() {
  dialog.showMessageBox({
    type: 'info',
    title: '同步',
    message: '同步功能将在 D4 里程碑接入：当前可正常浏览/写作（数据存本地），云端推拉暂未启用。',
  });
}

async function main() {
  const smoke = process.env.BYQX_SMOKE === '1';
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
    }
  }
  const config = cfg ?? {};

  const missing = REQUIRED_KEYS.filter((k) => !config[k]);
  if (missing.length > 0 && !smoke) {
    dialog.showErrorBox('缺少必填配置', `config.json 缺少：${missing.join(', ')}\n文件位置：${CONFIG_FILE}`);
  }

  const port = await pickPort(Number(config.PORT) || 43217);
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
  await import(pathToFileURL(entryPath).href);
  const siteUrl = `http://127.0.0.1:${port}`;
  await waitForServer(siteUrl);

  // ---- 冒烟模式：首页 200 即成功退出（go/no-go 验证用） ----
  if (smoke) {
    const res = await fetch(siteUrl, { signal: AbortSignal.timeout(15000) });
    console.log(`BYQX_SMOKE_OK status=${res.status} url=${siteUrl}`);
    app.exit(res.ok ? 0 : 1);
    return;
  }

  // ---- 窗口 / 托盘 / 版本检查 ----
  mainWindow = createWindow(siteUrl);
  createTray(mainWindow);
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.on('activate', () => mainWindow?.show());
  app.on('before-quit', () => { globalThis.__quitting = true; });

  void checkVersion();
}

app.on('window-all-closed', () => { /* 托盘常驻：不自动退出 */ });
void main();
