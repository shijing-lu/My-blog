/** Additive deployment upgrades. Never drop, rename or overwrite business data. */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export function parseDeploymentSchema(source) {
  const statements = source.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
  const tables = [], indexes = [];
  for (const statement of statements) {
    const table = statement.match(/^CREATE TABLE "([a-z_]+)" \(([\s\S]*)\);$/);
    if (table) {
      const columns = table[2].split('\n').map(line => line.trim().replace(/,$/, ''))
        .filter(line => line.startsWith('"')).map(line => {
          const match = line.match(/^"([a-z_]+)"\s+(.+)$/);
          if (!match) throw new Error(`Cannot parse column in ${table[1]}`);
          return { name: match[1], definition: line };
        });
      tables.push({ name: table[1], columns, create: statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ') });
    } else if (/^CREATE (UNIQUE )?INDEX /.test(statement)) {
      indexes.push(statement.replace(/^(CREATE (?:UNIQUE )?INDEX) /, '$1 IF NOT EXISTS '));
    } else throw new Error('Unsupported deployment DDL; review the schema artifact');
  }
  return { tables, indexes };
}

export const schema = parseDeploymentSchema(readFileSync(new URL('../db/deployment-schema.sql', import.meta.url), 'utf8'));

export async function migrateEndpoint(name, url, { verifyOnly = false } = {}) {
  const client = postgres(url, { max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  try {
    let additions = 0;
    await client.begin(async tx => {
      await tx`SET LOCAL lock_timeout = '15s'`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx`SELECT pg_advisory_xact_lock(77321042)`;
      if (!verifyOnly) for (const table of schema.tables) await tx.unsafe(table.create);
      const columns = await tx`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
      const existing = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
      const missing = [];
      for (const table of schema.tables) for (const column of table.columns) {
        if (existing.has(`${table.name}.${column.name}`)) continue;
        if (verifyOnly) missing.push(`${table.name}.${column.name}`);
        else {
          await tx.unsafe(`ALTER TABLE "${table.name}" ADD COLUMN IF NOT EXISTS ${column.definition}`);
          console.log(`[deployment-schema] ${name}: added ${table.name}.${column.name}`);
          additions++;
        }
      }
      if (missing.length) throw new Error(`${name}: missing schema: ${missing.join(', ')}`);
      if (!verifyOnly) for (const statement of schema.indexes) await tx.unsafe(statement);
      // Actual SELECTs verify permissions, column existence and projection on every business table.
      for (const table of schema.tables) await tx.unsafe(`SELECT ${table.columns.map(c => `"${c.name}"`).join(',')} FROM "${table.name}" LIMIT 0`);
      // A transaction probe checks real boolean/timestamp round-trips without saving test rows.
      const id = `__deploy_probe_${crypto.randomUUID()}`;
      await tx`INSERT INTO ai_conversations (id,title,summarized,started_at,updated_at) VALUES (${id}, 'deployment probe', true, now(), now())`;
      const rows = await tx`SELECT summarized, started_at FROM ai_conversations WHERE id = ${id}`;
      if (rows[0]?.summarized !== true || !(rows[0]?.started_at instanceof Date)) throw new Error(`${name}: boolean/timestamp round-trip failed`);
      await tx`UPDATE ai_conversations SET summarized = false WHERE id = ${id}`;
      const changed = await tx`SELECT summarized FROM ai_conversations WHERE id = ${id}`;
      if (changed[0]?.summarized !== false) throw new Error(`${name}: update probe failed`);
      await tx`DELETE FROM ai_conversations WHERE id = ${id}`;
    });
    console.log(`[deployment-schema] ${name}: ${schema.tables.length} tables verified, ${additions} columns added; boolean/timestamp/CRUD probe passed`);
  } finally {
    await client.end({ timeout: 5 });
  }
}
