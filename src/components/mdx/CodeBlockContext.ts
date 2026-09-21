/**
 * 代码块上下文 —— 区分「代码块内的 code」与「行内 code」
 *
 * ## 为什么需要 Context（而不是靠 className 猜）
 * `registry.tsx` 把 `code` 映射到 `InlineCode` 后，**代码块内的 code（`pre > code`）
 * 也会走同一个组件**（MDX 对嵌套元素同样应用组件映射）。要区分二者：
 * - ❌ 靠 `className` 是否含 `language-xx`：不可靠 —— `rehypeSkipHugeCode` 会
 *   主动摘掉超长代码块的 language 类（跳过高亮），此时块级 code 会被误判为行内；
 * - ✅ 由 `Pre` 在渲染子树时提供 Context：这是 React 的标准做法，判断依据是**真实的
 *   渲染树父子关系**，与类名/属性无关。
 *
 * 默认值 `false`（不在代码块内）——代码块外的任何 `<code>` 都按行内处理，
 * 与「行内代码提供一键复制」的需求一致。
 */
import { createContext, useContext } from 'react';

/** 是否处于代码块（`pre`）内部 */
export const CodeBlockContext = createContext(false);

/** 读取当前是否在代码块内 */
export function useInsideCodeBlock(): boolean {
  return useContext(CodeBlockContext);
}
