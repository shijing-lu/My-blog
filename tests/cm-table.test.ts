import { describe, expect, it } from 'vitest';
import { applyTableOperation, buildTableMarkdown, isTableRow, parseTable } from '../src/components/admin/cm-table';

const source = ['| 名称 | 数量 |', '| :--- | ---: |', '| A\\|B | 2 |', '| C | 10 |'];

describe('可视化表格与 Markdown 源码往返', () => {
  it('识别省略外侧竖线的 GFM 表格，保留转义竖线与列对齐', () => {
    expect(isTableRow('名称 | 数量')).toBe(true);
    const table = parseTable(source);
    expect(table).toEqual({ header: ['名称', '数量'], aligns: ['left', 'right'], rows: [['A|B', '2'], ['C', '10']] });
    expect(parseTable(buildTableMarkdown(table!).split('\n'))).toEqual(table);
    expect(parseTable(['| A | B |', '| --- | --- |', '| one | two | extra |'])).toBeNull();
  });

  it('行列编辑、排序、对齐均不修改输入表格，输出可再次解析', () => {
    const original = parseTable(source)!;
    const inserted = applyTableOperation(original, { type: 'insertColumn', at: 1 })!;
    expect(inserted.header).toEqual(['名称', '', '数量']);
    expect(inserted.rows[0]).toEqual(['A|B', '', '2']);
    const moved = applyTableOperation(inserted, { type: 'moveColumn', from: 2, to: 0 })!;
    expect(moved.header).toEqual(['数量', '名称', '']);
    expect(moved.aligns).toEqual(['right', 'left', 'left']);
    const sorted = applyTableOperation(original, { type: 'sort', at: 1, direction: 'desc' })!;
    expect(sorted.rows.map((row) => row[1])).toEqual(['10', '2']);
    expect(parseTable(buildTableMarkdown(moved).split('\n'))).toEqual(moved);
    expect(original.rows[0]).toEqual(['A|B', '2']);
  });

  it('不允许删除仅剩的行或列', () => {
    const one = parseTable(['| A |', '| --- |', '| x |'])!;
    expect(applyTableOperation(one, { type: 'deleteRow', at: 0 })).toBeNull();
    expect(applyTableOperation(one, { type: 'deleteColumn', at: 0 })).toBeNull();
  });
});
