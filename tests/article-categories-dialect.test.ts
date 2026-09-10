/**
 * 写作台自定义分类：双方言 schema 一致性回归
 *
 * `article_categories` / `article_post_categories` 在 schema.sqlite.ts 与 schema.pg.ts
 * 各定义一份（项目约定：查询基于 sqlite 元数据构建、对 PG 生成同构 SQL）。
 * 历史上出现过「一方加列另一方遗漏」类风险（见 booleanFlag 事故），本测试静态
 * 断言两方言的表、列集合与物理列名完全一致——新增列时必须两边同步。
 *
 * 独立建表而非给 articles 加列的降级设计见 src/lib/article-categories.ts 头注：
 * 生产未跑迁移端点时查询容错为空，文章主流程不受影响。
 */
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as sqlite from '../db/schema.sqlite';
import * as pg from '../db/schema.pg';

const TABLES = ['articleCategories', 'articlePostCategories'] as const;

describe('写作台分类表：双方言一致性', () => {
  it('两张表在两个方言里都已导出', () => {
    for (const t of TABLES) {
      expect(sqlite[t], `schema.sqlite 缺少 ${t}`).toBeDefined();
      expect(pg[t], `schema.pg 缺少 ${t}`).toBeDefined();
    }
  });

  it('逻辑列 key 与物理列名两边完全一致', () => {
    for (const t of TABLES) {
      const s = getTableColumns(sqlite[t]);
      const p = getTableColumns(pg[t]);
      expect(Object.keys(s).sort(), `${t} 逻辑列 key 不一致`).toEqual(Object.keys(p).sort());
      expect(
        Object.values(s).map((c) => c.name).sort(),
        `${t} 物理列名不一致`,
      ).toEqual(Object.values(p).map((c) => c.name).sort());
    }
  });

  it('分类表必备列齐全（id/name/color/sort/created_at）', () => {
    const cols = getTableColumns(sqlite.articleCategories);
    expect(Object.keys(cols).sort()).toEqual(['color', 'createdAt', 'id', 'name', 'sort']);
  });

  it('归属表：article_id 为主键（单分类语义），categoryId 非空', () => {
    const cols = getTableColumns(sqlite.articlePostCategories);
    expect(cols.articleId?.primary).toBe(true);
    expect(cols.categoryId?.notNull).toBe(true);
    const pgCols = getTableColumns(pg.articlePostCategories);
    expect(pgCols.articleId?.primary).toBe(true);
    expect(pgCols.categoryId?.notNull).toBe(true);
  });
});
