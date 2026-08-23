// @ts-check
/**
 * Astro 全局配置
 *
 * <!-- Imports -->
 * @typedef {import('astro/config').AstroUserConfig} AstroUserConfig
 */
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * <!-- Logic -->
 * 说明：
 * - output: 'server' —— 需要 API 路由（/api/*）与动态渲染，配合 Vercel Serverless。
 * - adapter: vercel() —— Vercel 部署适配器。
 * - @tailwindcss/vite —— Tailwind CSS v4 的 Vite 插件（CSS-first 配置）。
 * - resolve.alias['@'] —— 指向 src，供 tsconfig 的 paths 同步使用。
 * - image.service —— 本地图片服务，避免依赖远程图片优化（个人博客无需）。
 */
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  // 页面切换预取：悬停链接时提前请求新页面（含 SSR），点击时近乎零等待，
  // 消除 View Transition 的"点击→等待服务端渲染→出现"卡顿；慢连接自动禁用
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
