/**
 * 桌面端构建脚本（package.json `build:desktop`）
 *
 * 与 Web 构建（`build`）的差异：
 * - **不执行** 5 个 migrate-*.mjs 前置脚本：它们直连 `DATABASE_URL` 指向的数据库跑数据迁移，
 *   桌面构建必须跳过（否则每次打包都会对生产库执行一遍迁移）；
 * - 设置 `DESKTOP=1`：astro.config.mjs 据此切换到 `@astrojs/node` standalone 适配器，
 *   产出 `dist/server/entry.mjs`（Electron 主进程动态 import 即起本地服务）；
 * - Vite define `import.meta.env.PROD=true` 由 astro build 默认保证。
 */
process.env.DESKTOP = '1';

const { spawnSync } = await import('node:child_process');
const result = spawnSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});
process.exit(result.status ?? 1);
