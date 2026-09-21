/**
 * AI 小卿数据层：方言一致性 + 同步策略登记 + DDL 与 schema 不漂移 + 幂等建表实测
 *
 * 这类测试的必要性（项目既有教训）：新增表最常见的三种事故——
 * ① 只改一侧方言（另一侧查询报列不存在）；② 忘了在 sync/tables.ts 登记（桌面端静默不同步）；
 * ③ 惰性建表 DDL 与 schema 定义漂移（新库少列，老库查不到）。三条全部在此拦住。
 *
 * ⚠️ 「换库实测」拆到了 `ai-store-ensure.test.ts`：`db/dialect.ts` 的 `isDesktopMode` 是**模块加载时**
 * 求值的常量，同一文件里先加载过它再改 env 是无效的（vitest 按文件隔离模块，故单独成文件）。
 */
import { it, expect } from 'vitest';
import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import * as sqliteSchema from '../db/schema.sqlite';
import * as pgSchema from '../db/schema.pg';
import { policyFor, tablesMissingPolicy } from '../src/sync/tables';

/** 本功能新增的 4 张表（逻辑名 = 导出名） */
const AI_TABLES = ['aiConversations', 'aiMessages', 'aiMemories', 'aiBond'] as const;

/** drizzle 表类型（sqlite/pg 各自结构不同，此处只取公共能力） */
type AnyTable = Parameters<typeof getTableColumns>[0];

/** 取某 schema 模块里的表定义 */
function tableOf(mod: Record<string, unknown>, name: string): AnyTable {
  const t = mod[name];
  expect(isTable(t as never), `${name} 不是 drizzle 表`).toBe(true);
  return t as AnyTable;
}

it('4 张 AI 表的双方言列定义完全一致（逻辑键 + 物理列名）', () => {
  for (const key of AI_TABLES) {
    const s = tableOf(sqliteSchema, key);
    const p = tableOf(pgSchema, key);

    expect(getTableName(p), `${key} 物理表名两侧不一致`).toBe(getTableName(s));

    const sCols = getTableColumns(s);
    const pCols = getTableColumns(p);
    expect(Object.keys(pCols).sort(), `${key} 逻辑列键不一致`).toEqual(Object.keys(sCols).sort());

    const sPhysical = Object.values(sCols).map((c) => c.name).sort();
    const pPhysical = Object.values(pCols).map((c) => c.name).sort();
    expect(pPhysical, `${key} 物理列名不一致`).toEqual(sPhysical);
  }
});

it('4 张 AI 表都登记了 lww/updated_at 同步策略', () => {
  const names = AI_TABLES.map((k) => getTableName(tableOf(sqliteSchema, k)));
  expect(names).toEqual(['ai_conversations', 'ai_messages', 'ai_memories', 'ai_bond']);
  for (const n of names) {
    const policy = policyFor(n);
    expect(policy, `${n} 未登记同步策略`).toBeTruthy();
    expect(policy!.role).toBe('lww');
    expect(policy!.changeBy).toBe('updated_at');
  }
});

it('新增表不会被"缺策略"巡检误报', () => {
  const all = ['articles', 'settings', ...AI_TABLES.map((k) => getTableName(tableOf(sqliteSchema, k)))];
  expect(tablesMissingPolicy(all)).toEqual([]);
});

it('惰性建表 DDL 覆盖全部 4 张表，且列名与 schema 不漂移', async () => {
  const { AI_DDL_SQLITE, AI_DDL_PG, AI_TABLE_NAMES } = await import('../src/lib/ai-store');
  const expected = AI_TABLES.map((k) => getTableName(tableOf(sqliteSchema, k))).sort();
  expect([...AI_TABLE_NAMES].sort()).toEqual(expected);

  for (const [ddlList, mod, label] of [
    [AI_DDL_SQLITE, sqliteSchema, 'SQLite'] as const,
    [AI_DDL_PG, pgSchema, 'PG'] as const,
  ]) {
    for (const k of AI_TABLES) {
      const physical = getTableName(tableOf(mod, k));
      expect(
        ddlList.some((d) => d.includes(`CREATE TABLE IF NOT EXISTS ${physical} `)),
        `${label} DDL 缺少建表：${physical}`,
      ).toBe(true);
    }
    for (const k of AI_TABLES) {
      const physical = getTableName(tableOf(mod, k));
      const stmt = ddlList.find((d) => d.includes(`CREATE TABLE IF NOT EXISTS ${physical} `))!;
      const body = stmt.slice(stmt.indexOf('(') + 1, stmt.lastIndexOf(')'));
      const ddlCols = body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/\s+/)[0]!)
        .sort();
      const schemaCols = Object.values(getTableColumns(tableOf(mod, k))).map((c) => c.name).sort();
      expect(ddlCols, `${label} ${physical} 的 DDL 列与 schema 漂移`).toEqual(schemaCols);
    }
  }
});
