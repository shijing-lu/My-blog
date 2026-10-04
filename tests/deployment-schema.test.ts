import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import * as pg from '../db/schema.pg';
import * as sqlite from '../db/schema.sqlite';
import { schema, parseDeploymentSchema } from '../scripts/deployment-migration.mjs';

describe('deployment schema', () => {
  it('covers every PG table and column, including all newly created features', () => {
    const tables = Object.values(pg).filter(isTable);
    expect(schema.tables).toHaveLength(tables.length);
    for (const table of tables) {
      const ddl = schema.tables.find((item: { name: string }) => item.name === getTableName(table));
      expect(ddl?.columns.map((c: { name: string }) => c.name).sort()).toEqual(Object.values(getTableColumns(table)).map(c => c.name).sort());
    }
  });
  it('SQLite and PG expose the same business columns', () => {
    const local = new Map(Object.values(sqlite).filter(isTable).map(table => [getTableName(table), table]));
    for (const table of Object.values(pg).filter(isTable)) {
      const counterpart = local.get(getTableName(table));
      expect(counterpart).toBeDefined();
      expect(Object.values(getTableColumns(counterpart!)).map(c => c.name).sort()).toEqual(Object.values(getTableColumns(table)).map(c => c.name).sort());
    }
  });
  it('only emits idempotent create operations and rejects destructive DDL', () => {
    expect(schema.tables.every((t: { create: string }) => t.create.startsWith('CREATE TABLE IF NOT EXISTS '))).toBe(true);
    expect(schema.indexes.every((s: string) => /^CREATE (UNIQUE )?INDEX IF NOT EXISTS /.test(s))).toBe(true);
    expect(() => parseDeploymentSchema('DROP TABLE articles;')).toThrow('Unsupported');
  });
});
