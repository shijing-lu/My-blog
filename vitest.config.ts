/**
 * vitest 配置
 *
 * - environment: node（渲染引擎/数据层为服务端代码）
 * - 解析 `@/*` 别名
 * - 收集 tests/ 与各组件就近的 __tests__/ 下的 *.test.ts
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
