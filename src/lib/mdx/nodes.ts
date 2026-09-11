/**
 * MDX 节点构造助手
 *
 * 从 mdx-plugins.ts 拆出（P1-9 大文件拆分）：本模块只依赖 mdast 类型，
 * 是 callout / collapse / tabs / 脚注 四块的公共底座——
 * 若让容器模块各自回头 import mdx-plugins，就会与插件数组形成循环引用，故单独下沉一层。
 */
import type { Node } from 'mdast';

/* ===== 节点构造助手（P3-7）=====
 * 本文件原先有 92 处 `as`，其中 16 处是 `{ ...(x as unknown as Record<…>), value: y } as unknown as Node`
 * 这种**双重断言**——把整条链的类型检查全部关掉，字段名写错（valeu/valu）也不会报错，
 * 只有运行时才发现节点没生效。
 *
 * 收敛思路：扩展节点类型（mdxJsxFlowElement / footnoteReference / footnoteDefinition）
 * 不在 mdast 的 `Node` 联合里，因此**边界处必然需要一次断言**；
 * 与其把断言撒在 16 个调用点，不如收进下面这几个带类型的构造函数里，
 * 让调用点全程类型安全，断言只此一处、且被注释说明。
 */

/**
 * 克隆节点并覆盖若干字段
 *
 * @param node 原节点（泛型保留其静态类型）
 * @param patch 要覆盖的字段；`Partial<T>` 之外的扩展字段（如 text 节点的 value）以宽松记录兼容
 */
export function patched<T extends object>(node: T, patch: Partial<T> & Record<string, unknown>): T {
  // 单点断言：扩展字段（value/children 等）不一定都落在 T 的键上
  return { ...node, ...patch } as T;
}

/** 便捷类型：含可选 name/children/attributes 的指令节点 */
export interface MdxDirectiveNode extends Node {
  name?: string;
  children?: Node[];
  /** remark-directive 解析出的属性（`:::collapse{accordion}` → `{ accordion: '' }`） */
  attributes?: Record<string, string>;
}

/** MDX JSX 属性节点 */
export interface MdxJsxAttr {
  type: 'mdxJsxAttribute';
  name: string;
  value: string;
}

/** MDX JSX 流元素节点（mdxJsxFlowElement，块级） */
export interface MdxJsxFlowNode {
  type: 'mdxJsxFlowElement';
  name: string;
  attributes: MdxJsxAttr[];
  children: Node[];
}

/** 构造 MDX JSX 流元素（如 <CollapsePanel open="true">…</CollapsePanel>） */
export function jsxFlow(name: string, attributes: MdxJsxAttr[], children: Node[]): Node {
  const node: MdxJsxFlowNode = { type: 'mdxJsxFlowElement', name, attributes, children };
  // 边界断言：mdxJsxFlowElement 不在 mdast Node 联合中（见本段顶部说明）
  return node as unknown as Node;
}

/** 构造 JSX 属性（布尔/字符串统一按字符串传，与 remark-directive 的属性语义一致） */
export function jsxAttr(name: string, value: string): MdxJsxAttr {
  return { type: 'mdxJsxAttribute', name, value };
}

/** 构造脚注引用节点 `[^id]` */
export function footnoteRef(identifier: string): Node {
  return { type: 'footnoteReference', identifier, label: identifier } as unknown as Node;
}

/** 构造脚注定义节点 `[^id]: 正文` */
export function footnoteDef(identifier: string, children: Node[]): Node {
  return {
    type: 'footnoteDefinition',
    identifier,
    label: identifier,
    children: [{ type: 'paragraph', children }],
  } as unknown as Node;
}

/** 构造纯文本节点 */
export function textNode(value: string): Node {
  return { type: 'text', value } as Node;
}

