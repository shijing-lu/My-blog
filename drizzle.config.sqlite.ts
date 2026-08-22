/**
 * Drizzle Kit 配置 —— SQLite（开发环境）
 *
 * 用法：pnpm db:push:dev（推送 schema 到本地库）
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.sqlite.ts',
  out: './db/migrations/sqlite',
  dbCredentials: {
    url: 'file:./data/blog.db',
  },
  verbose: true,
  strict: true,
});
