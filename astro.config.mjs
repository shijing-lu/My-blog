// @ts-check
/**
 * Astro 全局配置
 *
 * <!-- Imports -->
 * @typedef {import('astro/config').AstroUserConfig} AstroUserConfig
 */
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * <!-- Logic -->
 * 说明：
 * - output: 'server' —— 需要 API 路由（/api/*）与动态渲染。
 * - adapter 双形态（DESKTOP=1 时切 Node standalone，供 Electron 桌面端内嵌）：
 *     默认 vercel() —— Vercel 部署（Web 版主路径，保持零变化）；
 *     DESKTOP=1 时 node({ mode: 'standalone' }) —— 产出 dist/server/entry.mjs，
 *     `import` 即在 process.env.HOST/PORT 上起 HTTP 服务（Electron 主进程动态加载）。
 * - @tailwindcss/vite —— Tailwind CSS v4 的 Vite 插件（CSS-first 配置）。
 * - resolve.alias['@'] —— 指向 src，供 tsconfig 的 paths 同步使用。
 * - image.service —— 本地图片服务，避免依赖远程图片优化（个人博客无需）。
 */
const isDesktop = process.env.DESKTOP === '1';
export default defineConfig({
  output: 'server',
  adapter: isDesktop ? node({ mode: 'standalone' }) : vercel(),
  integrations: [react()],
  // 预取收敛：仅显式标记的链接可预取（默认 false），悬停策略保留；
  // 取消 prefetchAll 与导航 viewport 预取——此前每次进站并发预取 7+ 页面（每页一次 SSR+多查询），
  // 是 Vercel 请求量与冷启动排队的主要来源（详见性能优化批次）
  prefetch: {
    defaultStrategy: 'hover',
  },
  vite: {
    // 桌面构建（DESKTOP=1）：envDir 指向空目录 —— 根目录 .env / .env.production（内含
    // `[SENSITIVE]` 脱敏占位与本地 dev 值）不被加载，import.meta.env 保持干净，
    // 运行时全部由 Electron 主进程注入的 process.env 提供（见 desktop/main.cjs）。
    ...(isDesktop ? { envDir: fileURLToPath(new URL('./desktop/empty-env', import.meta.url)) } : {}),
    /**
     * ⚠️ 不要在此启用 `ssr.noExternal`（把依赖内联进 bundle）——实测会破坏服务端模块初始化：
     * 内联后 drizzle-orm 的 `customType` 在 schema 求值时为 undefined，
     * 报 `Class extends value undefined is not a constructor or null`（应用起不来）。
     * 自包含分发请走"复制依赖闭包"路线（scripts/make-desktop-bundle.mjs）。
     */
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 预打包 katex：cm-wysiwyg 在编辑器内 import('katex')（KaTeX 实时渲染）。
    // dev 下不做预打包时，首次动态 import 会触发运行时二次 optimize + 页面 reload，
    // 弱网/时序下可能让编辑器挂起的动态 import 落空；显式 include 让 dev 启动即就绪。
    optimizeDeps: {
      include: ['katex'],
    },
  },
});
