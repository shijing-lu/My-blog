/** 构建期幂等建表：随心录在生产 PG 主备库中均可用。 */
import postgres from 'postgres';

const DDL = `CREATE TABLE IF NOT EXISTS "quick_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "content" text NOT NULL DEFAULT '',
  "tags" text NOT NULL DEFAULT '[]',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
)`;

async function migrate(name, url) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return;
  const client = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
  try {
    await client.unsafe(DDL);
    console.log(`[migrate-quick-notes] ${name}: quick_notes 表就位`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

await migrate('primary', process.env.DATABASE_URL);
await migrate('fallback', process.env.DATABASE_URL_FALLBACK);
