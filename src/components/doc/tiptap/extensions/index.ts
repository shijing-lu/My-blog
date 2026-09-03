/**
 * index.ts —— 文档就地编辑（Tiptap）的扩展装配中心
 *
 * 职责：把 doc 就地编辑所需的全部 Tiptap 扩展组合成一个数组，供
 * MarkdownManager（round-trip 测试）与 DocTiptapEditor（运行时 useEditor）共同消费
 * —— 单一事实来源，避免两处扩展清单漂移导致「测试通过但编辑器行为不一致」。
 *
 * 扩展清单说明：
 * - StarterKit：段落/标题/粗斜/代码块/引用/列表/分割线等基础（v3 内建 Link）。
 * - TaskList/TaskItem：任务列表 `- [ ]`（StarterKit 未含，需显式注册）。
 * - TableKit：GFM 表格（v3.31 聚合包，含 row/cell/header + markdown 对齐支持）。
 * - Mathematics：KaTeX 公式 inlineMath/blockMath（latex 属性存源码）。
 *   编辑器场景通过 buildDocExtensionsWith({ onMathClick }) 注入 click 事件回调
 *   —— 用户点击公式时弹出 MathEditPopover 进入 LaTeX 源码编辑（Obsidian 交互）。
 * - Admonition：`:::note` 五类容器（本项目自定义，见 ./admonition）。
 */
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Admonition } from './admonition';
import type { AnyExtension } from '@tiptap/core';

/** 公式点击回调签名（编辑器场景注入；测试场景不传避免副作用） */
export type MathClickHandler = (
  node: { attrs: { latex?: string } },
  pos: number,
  kind: 'inline' | 'block',
) => void;

export interface DocExtOptions {
  /** 公式节点点击回调（编辑器场景传） */
  onMathClick?: MathClickHandler;
}

/**
 * 构建默认扩展组合（不传 onMathClick），给 MarkdownManager round-trip 测试用。
 * 测试路径不应被回调污染 —— 不传 onMathClick 是有意的。
 */
export function buildDocExtensions(): AnyExtension[] {
  return buildDocExtensionsWith();
}

/** 带运行时选项的扩展组合（编辑器场景用）。闭包内可安全引用 ref.current。 */
export function buildDocExtensionsWith(options: DocExtOptions = {}): AnyExtension[] {
  const { onMathClick } = options;
  const mathCfg = {
    katexOptions: { throwOnError: false, strict: false, output: 'htmlAndMathml' },
    // Mathematics 扩展的 onClick 回调签名是 ProseMirror Node（内部类型 `Node$1`），
  // 在 TS 类型层无法用结构化签名完全对齐。运行时调用方按约定结构取值。
  ...(onMathClick
      ? {
          inlineOptions: {
            onClick: ((node: unknown, pos: number) => onMathClick(node as { attrs: { latex?: string } }, pos, 'inline')) as any,
          },
          blockOptions: {
            onClick: ((node: unknown, pos: number) => onMathClick(node as { attrs: { latex?: string } }, pos, 'block')) as any,
          },
        }
      : {}),
  };
  return [
    StarterKit,
    TaskList,
    TaskItem,
    TableKit,
    // MathematicsOptions 是扩展的精确类型（含 katexOptions.strict 等联合类型）。
    // 本处只在 katexOptions 与可选 onClick 上做定制，整体 shape 与扩展强类型不完全对齐；
    // 运行时扩展只读 katexOptions 与 inlineOptions/blockOptions.onClick，故按 any 收口。
    (Mathematics as any).configure(mathCfg),
    Admonition,
  ];
}