/**
 * view-anchor 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * 这组纯函数是「阅读 ⇄ 就地编辑」模式切换定位的**唯一事实来源**：阅读态用
 * getBoundingClientRect().top 喂进来，编辑态用 CodeMirror 的 coordsAtPos().top
 * 喂进来，两侧必须得到**同一套判定**。所以除边界用例外，重点锁一条**往返不变量**：
 * pickViewAnchor 挑出的锚点，用 indexOfNthHeading 回查必须命中同一个下标 ——
 * 这条不变量一旦破掉，症状就是「进得去、出不来」这类只在单方向暴露的错位。
 */
import { describe, it, expect } from 'vitest';
import {
  ANCHOR_LEVELS,
  ANCHOR_TOP_TOLERANCE,
  indexOfNthHeading,
  pickNearestViewAnchor,
  pickViewAnchor,
} from '../src/lib/view-anchor';
import type { HeadingTop } from '../src/lib/view-anchor';

/** 便捷构造：h2/h3 混排（level, top 交替传参） */
function heads(...pairs: Array<[number, number]>): HeadingTop[] {
  return pairs.map(([level, top]) => ({ level, top }));
}

describe('pickViewAnchor', () => {
  it('空列表返回 null（调用方据此回落比例定位）', () => {
    expect(pickViewAnchor([])).toBeNull();
  });

  it('视口落在第一个标题之前 → null，不猜一个标题', () => {
    // 所有标题都还在视口下方
    expect(pickViewAnchor(heads([2, 120], [3, 400], [2, 900]))).toBeNull();
  });

  it('标题恰好在视口顶 → 命中，偏移 0', () => {
    expect(pickViewAnchor(heads([2, 0], [3, 300]))).toEqual({ level: 2, nth: 0, offset: 0 });
  });

  it('标题在视口顶上方 → 命中，偏移为负（原样保留，不做 clamp）', () => {
    expect(pickViewAnchor(heads([2, -640], [3, 40]))).toEqual({ level: 2, nth: 0, offset: -640 });
  });

  it('取「视口顶之上最后一个」标题，而不是第一个', () => {
    expect(pickViewAnchor(heads([2, -900], [3, -500], [2, -120], [3, 60]))).toEqual({
      level: 2,
      nth: 1,
      offset: -120,
    });
  });

  it('nth 按 level 分别计数（h2/h3 交替时互不干扰）', () => {
    const anchor = pickViewAnchor(heads([2, -800], [3, -600], [3, -400], [2, -200], [3, 10]));
    // 视口顶之上：h2#0、h3#0、h3#1、h2#1 → 最后一个 h2 是「第 1 个 h2」
    expect(anchor).toEqual({ level: 2, nth: 1, offset: -200 });
  });

  it('一旦遇到视口下方的标题就停止，不再往下看', () => {
    // 中间那个 top 超出容差 → 后面的标题（哪怕 top 又变小，非真实文档顺序）不再参与
    expect(pickViewAnchor(heads([2, -100], [3, 500], [2, -50]))).toEqual({
      level: 2,
      nth: 0,
      offset: -100,
    });
  });

  it('容差边界：top 恰等于容差算「之上」，超出 1px 即停止', () => {
    expect(pickViewAnchor(heads([2, ANCHOR_TOP_TOLERANCE]))).toEqual({
      level: 2,
      nth: 0,
      offset: ANCHOR_TOP_TOLERANCE,
    });
    expect(pickViewAnchor(heads([2, ANCHOR_TOP_TOLERANCE + 1]))).toBeNull();
  });

  it('h1 / h5 / h6 不参与锚点，且不打断扫描', () => {
    // h1 在视口上方、h5 也在上方，它们既不算锚点也不影响 h2 的 nth 计数
    expect(pickViewAnchor(heads([1, -900], [2, -600], [5, -300], [6, -100]))).toEqual({
      level: 2,
      nth: 0,
      offset: -600,
    });
  });

  it('ANCHOR_LEVELS 就是目录 TOC 使用的 h2–h4', () => {
    expect([...ANCHOR_LEVELS]).toEqual([2, 3, 4]);
  });
});

describe('pickNearestViewAnchor', () => {
  it('选取刚进入视口、比上一标题更近的标题，避免跨长小节按像素深度映射', () => {
    expect(pickNearestViewAnchor(heads([2, -4052], [2, 51], [2, 3000]))).toEqual({
      level: 2, nth: 1, offset: 51,
    });
  });

  it('下一标题距离更远时保留视口上方的标题', () => {
    expect(pickNearestViewAnchor(heads([2, -120], [3, 450]))).toEqual({
      level: 2, nth: 0, offset: -120,
    });
  });
});

describe('indexOfNthHeading', () => {
  const list = heads([2, 0], [3, 0], [3, 0], [2, 0], [4, 0]);

  it('按「同 level 第 nth 个」定位下标', () => {
    expect(indexOfNthHeading(list, 2, 0)).toBe(0);
    expect(indexOfNthHeading(list, 2, 1)).toBe(3);
    expect(indexOfNthHeading(list, 3, 0)).toBe(1);
    expect(indexOfNthHeading(list, 3, 1)).toBe(2);
    expect(indexOfNthHeading(list, 4, 0)).toBe(4);
  });

  it('越界返回 -1（标题被删 / 序号漂移时的回落信号）', () => {
    expect(indexOfNthHeading(list, 2, 2)).toBe(-1);
    expect(indexOfNthHeading(list, 5, 0)).toBe(-1);
    expect(indexOfNthHeading([], 2, 0)).toBe(-1);
  });
});

describe('往返不变量：pickViewAnchor ↔ indexOfNthHeading 必须自洽', () => {
  /**
   * 构造一条文档顺序的标题序列（level 2–4）。
   * top 全部取「视口上方」（i - 1000），使 slice 出来的任意前缀都整体位于视口顶之上 ——
   * 这样往返不变量测的是「序列对齐」，不被容差截断干扰（截断单独有用例覆盖）。
   */
  function doc(levels: number[]): HeadingTop[] {
    return levels.map((level, i) => ({ level, top: i - 1000 }));
  }

  const cases: number[][] = [
    [2, 2, 2],
    [2, 3, 2, 3],
    [2, 3, 4, 3, 2],
    [2, 3, 4],
    [2, 2, 3, 3, 4, 4],
    [3, 3, 3],
  ];

  it.each(cases.map((c) => [c.join('-'), c] as const))(
    'levels=%s：锚点回查命中同一标题',
    (_label, levels) => {
      const list = doc(levels);
      // 逐个「视口位置」试：视口顶落在第 cut 个标题上时，锚点必须能回查到 cut
      for (let cut = 0; cut < list.length; cut++) {
        const anchor = pickViewAnchor(list.slice(0, cut + 1));
        expect(anchor).not.toBeNull();
        const idx = indexOfNthHeading(list, anchor!.level, anchor!.nth);
        expect(idx).toBe(cut);
        expect(list[idx]!.level).toBe(anchor!.level);
      }
    },
  );

  it('真实长文（章节 + 小节交错）在任意视口位置都自洽', () => {
    const levels = [2, 3, 3, 4, 4, 3, 2, 3, 4, 2, 3, 3];
    const list = doc(levels);
    for (let cut = 0; cut < list.length; cut++) {
      const anchor = pickViewAnchor(list.slice(0, cut + 1))!;
      expect(indexOfNthHeading(list, anchor.level, anchor.nth)).toBe(cut);
    }
  });
});
