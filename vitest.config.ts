/**
 * vitest 配置
 *
 * - environment: node（渲染引擎/数据层为服务端代码）
 * - 解析 `@/*` 别名
 * - 仅收集 tests/ 下的 *.test.ts
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
