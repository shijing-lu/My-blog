import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import * as sqliteSchema from '../db/schema.sqlite';
import * as pgSchema from '../db/schema.pg';
import { LOCAL_ONLY_TABLES } from '../src/sync/tables';

describe('双方言 Schema 结构严格双向对称性校验', () => {
  const localOnlySet = new Set<string>(LOCAL_ONLY_TABLES);

  const sqliteTables = Object.values(sqliteSchema).filter(isTable);
  const pgTables = Object.values(pgSchema).filter(isTable);

  const sqliteMap = new Map<string, any>(sqliteTables.map((t) => [getTableName(t), t]));
  const pgMap = new Map<string, any>(pgTables.map((t) => [getTableName(t), t]));

  it('表集合必须完全双向对称（非 LOCAL_ONLY_TABLES 的业务表不得单侧孤立）', () => {
    const sqliteOnly = [...sqliteMap.keys()].filter((k) => !pgMap.has(k) && !localOnlySet.has(k));
    const pgOnly = [...pgMap.keys()].filter((k) => !sqliteMap.has(k));

    expect(sqliteOnly, `仅存在于 SQLite 未在 PG 声明的业务表: ${sqliteOnly.join(', ')}`).toEqual([]);
    expect(pgOnly, `仅存在于 PG 未在 SQLite 声明的业务表: ${pgOnly.join(', ')}`).toEqual([]);
  });

  it('每一张业务表的字段名列表必须完全一致', () => {
    const mismatches: string[] = [];

    for (const [tableName, sTable] of sqliteMap) {
      if (localOnlySet.has(tableName)) continue;
      const pTable = pgMap.get(tableName);
      if (!pTable) continue;

      const sCols = Object.values(getTableColumns(sTable)).map((c: any) => c.name).sort();
      const pCols = Object.values(getTableColumns(pTable)).map((c: any) => c.name).sort();

      if (JSON.stringify(sCols) !== JSON.stringify(pCols)) {
        mismatches.push(
          `[表: ${tableName}]\n  SQLite 列: [${sCols.join(', ')}]\n  PG 列:     [${pCols.join(', ')}]`,
        );
      }
    }

    expect(mismatches, mismatches.join('\n\n')).toEqual([]);
  });

  it('每一张业务表的字段可空性（notNull）必须双方言保持一致', () => {
    const nullabilityMismatches: string[] = [];

    for (const [tableName, sTable] of sqliteMap) {
      if (localOnlySet.has(tableName)) continue;
      const pTable = pgMap.get(tableName);
      if (!pTable) continue;

      const sColMap = getTableColumns(sTable) as Record<string, any>;
      const pColMap = getTableColumns(pTable) as Record<string, any>;

      for (const [colKey, sCol] of Object.entries(sColMap)) {
        const pCol = pColMap[colKey];
        if (!pCol) continue;

        if (sCol.notNull !== pCol.notNull) {
          nullabilityMismatches.push(
            `[表: ${tableName}, 字段: ${sCol.name}] notNull 约束不一致: SQLite=${sCol.notNull}, PG=${pCol.notNull}`,
          );
        }
      }
    }

    expect(nullabilityMismatches, nullabilityMismatches.join('\n')).toEqual([]);
  });
});
