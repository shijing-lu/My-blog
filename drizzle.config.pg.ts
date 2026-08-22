/**
 * Drizzle Kit 配置 —— PostgreSQL（生产环境）
 *
 * 用法：
 * - pnpm db:generate:pg —— 生成迁移
 * - pnpm db:migrate:pg  —— 应用迁移（需 DATABASE_URL 指向生产库）
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.pg.ts',
  out: './db/migrations/pg',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
