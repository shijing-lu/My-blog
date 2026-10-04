/**
 * view-anchor.ts —— 视口锚点的**纯函数**定义（阅读态与编辑态共用同一份规则）
 *
 * 模式切换（阅读 ⇄ 就地编辑）要在两种完全不同的布局里复现「同一阅读位置」。
 * 用像素比例做映射（渲染高 vs 源码高）密度差异太大，必然偏移：KaTeX 公式、
 * 图片、表格、代码块在源码里是一行、在渲染后可能是几百像素。
 * 故改用「标题锚点 + 段内偏移」：模式切换取距视口顶最近的 h2–h4，记录
 * 「同 level 第 nth 个」+「该标题距视口顶的偏移」，对侧按同一序列对齐复现。
 *
 * 为什么抽到这里：两侧的**输入形态**不同（阅读态是渲染 DOM 的
 * `getBoundingClientRect().top`，编辑态是 CodeMirror 的 `coordsAtPos().top`），
 * 但**判定规则必须逐字一致** —— 否则会出现「进得去、出不来」这类只在单方向
 * 暴露的错位，而且只在边界输入（视口恰好在标题上、标题重名、视口在第一标题
 * 之前）下暴露。共用一份实现 + 单测锁住，比各写一份可靠。
 */

/** 视口锚点：标题 + 该标题距视口顶的像素偏移（负 = 在视口顶上方） */
export interface ViewAnchor {
  /** 标题级别（2–4） */
  level: number;
  /** 同 level 内第几个（0 起）——「序列对齐」主键，不依赖 slug / 文本 */
  nth: number;
  /** 标题顶边距视口顶的偏移（px） */
  offset: number;
}

/**
 * 顶部容差（px）：标题距视口顶不超过该值即算「在视口顶之上（含）」。
 * 取几像素而非 0，是为了容纳亚像素舍入与滚动惯性带来的 1–2px 抖动。
 */
export const ANCHOR_TOP_TOLERANCE = 8;

/** 参与锚点的标题级别范围（与目录 TOC 的 h2–h4 一致） */
export const ANCHOR_LEVELS: readonly number[] = [2, 3, 4];

/** 文档顺序的标题（只需级别与距视口顶的偏移） */
export interface HeadingTop {
  level: number;
  top: number;
}

/**
 * 从「文档顺序的标题列表」里挑出视口顶之上（含）最后一个 h2–h4。
 *
 * 入参须已按文档顺序排列；`top` 为各标题顶边距视口顶的偏移（可为负）。
 * 一旦遇到偏移超出容差的标题即停止 —— 文档顺序下其后只会更靠下。
 * 视口落在第一个 h2–h4 之前（或整篇没有 h2–h4）时返回 null，
 * 调用方应回落到比例定位，而不是猜一个标题。
 */
export function pickViewAnchor(
  headings: ReadonlyArray<HeadingTop>,
  tolerance: number = ANCHOR_TOP_TOLERANCE,
): ViewAnchor | null {
  const seen = new Map<number, number>();
  let cur: ViewAnchor | null = null;
  for (const h of headings) {
    if (!ANCHOR_LEVELS.includes(h.level)) continue;
    if (h.top > tolerance) break;
    const nth = seen.get(h.level) ?? 0;
    seen.set(h.level, nth + 1);
    cur = { level: h.level, nth, offset: h.top };
  }
  return cur;
}

/** 模式切换选取距视口顶最近的标题，包含刚进入视口的下一标题。 */
export function pickNearestViewAnchor(headings: ReadonlyArray<HeadingTop>): ViewAnchor | null {
  const seen = new Map<number, number>();
  let above: ViewAnchor | null = null;
  for (const h of headings) {
    if (!ANCHOR_LEVELS.includes(h.level)) continue;
    const nth = seen.get(h.level) ?? 0;
    seen.set(h.level, nth + 1);
    const candidate = { level: h.level, nth, offset: h.top };
    if (h.top <= ANCHOR_TOP_TOLERANCE) {
      above = candidate;
      continue;
    }
    return !above || h.top < Math.abs(above.offset) ? candidate : above;
  }
  return above;
}

/**
 * 在「文档顺序的标题列表」里找出第 nth 个（0 起）level 级标题的下标。
 * 与 pickViewAnchor / heading-index 的 nthHeading 同一套序列对齐语义；越界返回 -1。
 */
export function indexOfNthHeading(
  headings: ReadonlyArray<{ level: number }>,
  level: number,
  nth: number,
): number {
  let seen = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i]!.level !== level) continue;
    seen += 1;
    if (seen === nth) return i;
  }
  return -1;
}
