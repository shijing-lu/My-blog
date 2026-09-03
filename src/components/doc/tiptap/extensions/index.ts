/**
 * index.ts —— 文档就地编辑（Tiptap）的扩展装配中心
 *
 * 职责：把 doc 就地编辑所需的全部 Tiptap 扩展组合成一个数组
 * （buildDocExtensions），供 MarkdownManager（round-trip 测试）与
 * DocTiptapEditor（运行时 useEditor）共同消费 —— 单一事实来源，避免两处
 * 扩展清单漂移导致「测试通过但编辑器行为不一致」。
 *
 * 扩展清单说明：
 * - StarterKit：段落/标题/粗斜/代码块/引用/列表/分割线等基础（v3 内建 Link）。
 * - TaskList/TaskItem：任务列表 `- [ ]`（StarterKit 未含，需显式注册）。
 * - TableKit：GFM 表格（v3.31 聚合包，含 row/cell/header + markdown 对齐支持）。
 * - Mathematics：KaTeX 公式 inlineMath/blockMath（latex 属性存源码）。
 * - Admonition：`:::note` 五类容器（本项目自定义，见 ./admonition）。
 */
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Admonition } from './admonition';

/** 构建文档编辑扩展组合（供 MarkdownManager 与 useEditor 复用） */
export function buildDocExtensions() {
  return [
    StarterKit,
    TaskList,
    TaskItem,
    TableKit,
    Mathematics.configure({
      katexOptions: { throwOnError: false, strict: false, output: 'htmlAndMathml' },
    }),
    Admonition,
  ];
}
