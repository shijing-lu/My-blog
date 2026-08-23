/**
 * 运行方言判断（独立模块，避免 schema ↔ db/index 循环依赖）
 *
 * - `DATABASE_URL` 以 `postgres://`/`postgresql://` 开头 → PostgreSQL（生产）
 * - 其余（默认 `file:./data/blog.db`）→ SQLite（开发）
 */
const DATABASE_URL: string = process.env.DATABASE_URL ?? 'file:./data/blog.db';

/** 是否为 PostgreSQL（生产） */
export const isPostgres: boolean = /^postgres(ql)?:\/\//.test(DATABASE_URL);
