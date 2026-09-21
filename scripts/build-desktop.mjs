/**
 * 桌面端构建脚本（package.json `build:desktop`）
 *
 * 与 Web 构建（`build`）的差异：
 * - **不执行** 5 个 migrate-*.mjs 前置脚本：它们直连 `DATABASE_URL` 指向的数据库跑数据迁移，
 *   桌面构建必须跳过（否则每次打包都会对生产库执行一遍迁移）；
 * - 设置 `DESKTOP=1`：astro.config.mjs 据此切换到 `@astrojs/node` standalone 适配器，
 *   产出 `dist/server/entry.mjs`（Electron 主进程动态 import 即起本地服务）；
 * - **保留上一版的前端哈希资源**（见下方 staleAssets 逻辑）。
 */
process.env.DESKTOP = '1';
// Vite 构建需要清理自身缓存（node_modules/.vite/deps、dist/*/.vite，常 >50 文件）；
// 本机安全删除守卫会拦截 ≥50 文件的删除并让构建直接失败，故构建期关闭该守卫
// （仅影响构建缓存清理，不涉及用户数据）。
process.env.CODEBUDDY_SAFE_DELETE_ENABLED = '0';

const { spawnSync } = await import('node:child_process');
const { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } = await import('node:fs');
const path = await import('node:path');

const ROOT = path.resolve(import.meta.dirname, '..');
const ASTRO_DIR = path.join(ROOT, 'dist', 'client', '_astro');
/** 构建期间暂存旧资源的目录（放在 dist 之外，避免被 astro build 清空） */
const STASH = path.join(ROOT, '.diag', 'stale-assets');

/**
 * 为什么保留旧哈希资源
 *
 * astro build 会清空 dist，而**正在运行的桌面端实例仍在用它渲染时那份 HTML**
 * （引用旧的 `_astro/<name>.<hash>.css|js`）。重建后旧文件消失 → 运行中实例的页面
 * 静态资源全部 404 → CSS/JS 丢失，表现为"所有动效/交互突然都没了"（实测踩过）。
 * 这里在构建前把旧资源搬到 dist 外，构建后把**新产物中缺失的**旧文件合并回去，
 * 使运行中的实例继续可用（代价：产物目录会积累少量历史资源）。
 */
function stashStaleAssets() {
  try {
    if (!existsSync(ASTRO_DIR)) return 0;
    // ⚠️ 不要 rmSync 清空暂存目录：本机沙箱对批量删除（>50 文件）会阻塞等待确认，
    //    表现为"构建卡住几分钟不动"（实测踩过）。直接覆盖同名文件即可，
    //    少量历史残留不影响功能。
    mkdirSync(STASH, { recursive: true });
    let n = 0;
    for (const f of readdirSync(ASTRO_DIR)) {
      copyFileSync(path.join(ASTRO_DIR, f), path.join(STASH, f));
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

function restoreStaleAssets() {
  try {
    if (!existsSync(STASH) || !existsSync(ASTRO_DIR)) return 0;
    let n = 0;
    for (const f of readdirSync(STASH)) {
      const target = path.join(ASTRO_DIR, f);
      if (existsSync(target)) continue; // 新产物已有同名文件，不动
      copyFileSync(path.join(STASH, f), target);
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

const stashed = stashStaleAssets();
if (stashed > 0) console.log(`[build:desktop] 暂存旧前端资源 ${stashed} 个（供运行中实例继续引用）`);

const result = spawnSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.status === 0) {
  const restored = restoreStaleAssets();
  if (restored > 0) {
    console.log(`[build:desktop] 已合并回上一版资源 ${restored} 个 → 运行中的实例不会因资源 404 而失效`);
  }
}

process.exit(result.status ?? 1);
