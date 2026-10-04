/**
 * heading-index.ts —— Markdown 源码标题索引（目录点击跳转的定位基础）
 *
 * 用 lang-markdown 的 Lezer 语法树枚举标题，而非正则扫行：
 * - 代码块/行内代码里的 `#` 不会产生 ATXHeading* 节点，天然排除误判；
 * - setext 下划线式标题（`标题\n===`）免费覆盖；
 * - 直接用文档 offset 定位，无需再换算行号。
 *
 * 定位策略「序列对齐」：目录项顺序 = 渲染管线提取的标题序列，语法树扫描源码得到
 * 同一篇文档的标题序列，两侧按「同 level 各自第 N 个」一一对应——不依赖 slug 或
 * 文本内容，对重名标题、数学公式标题、中文 slug 差异全部免疫。
 * 文本（normHeadingText）只用于一致性校验告警。
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';

// 同一文档移动光标/滚动时复用索引；语法树改变（含后台解析推进）时自动失效。
const headingCache = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; headings: HeadingHit[] }>();

/** 语法树中的一个标题 */
export interface HeadingHit {
  /** 标题节点起始 offset */
  pos: number;
  /** 级别（1–6） */
  level: number;
  /** 标题文本（已去掉 `#` 标记与收尾 `#`） */
  text: string;
}

/** 标题节点名：ATXHeading1–6 / SetextHeading1–2 */
const HEADING_NODE = /^(?:ATXHeading([1-6])|SetextHeading([1-2]))$/;

/** 标题文本 → 规范化形态（校验用：折叠空白、去掉数学/强调记号、小写） */
export function normHeadingText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[$*`_]/g, '').trim().toLowerCase();
}

/** 从节点原文提取标题文本：去 `#` 前缀、收尾 `#`，setext 还需去掉下划线行 */
function headingText(raw: string): string {
  return (
    raw
      .split('\n')[0]!
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '')
      .replace(/[ \t]*#+[ \t]*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** 扫描全文标题（文档顺序） */
export function scanHeadings(state: EditorState, complete = false): HeadingHit[] {
  // 大文档的初始语法树通常只解析了开头。模式切换时必须把整篇标题索引补齐，
  // 否则第 N 个标题会查不到，并退到误差很大的高度比例定位。
  const tree = (complete ? ensureSyntaxTree(state, state.doc.length, 200) : null) ?? syntaxTree(state);
  const cached = headingCache.get(state.doc);
  if (cached?.tree === tree) return cached.headings;
  const out: HeadingHit[] = [];
  tree.iterate({
    enter: (node) => {
      const m = HEADING_NODE.exec(node.name);
      if (!m) return;
      out.push({
        pos: node.from,
        level: Number(m[1] ?? m[2]),
        text: headingText(state.sliceDoc(node.from, node.to)),
      });
    },
  });
  headingCache.set(state.doc, { tree, headings: out });
  return out;
}

/**
 * 取第 nth 个（0 起）level 级标题；越界返回 null。
 * 索引由不可变文档与当前语法树共同缓存；标题增删或后台解析推进后重新扫描。
 */
export function nthHeading(state: EditorState, level: number, nth: number): HeadingHit | null {
  let seen = -1;
  const found: HeadingHit[] = [];
  for (const h of scanHeadings(state, true)) {
    if (h.level !== level) continue;
    seen += 1;
    if (seen === nth) {
      found.push(h);
      break;
    }
  }
  return found[0] ?? null;
}
