/**
 * DocTiptapEditor.tsx —— 文档就地编辑的 Tiptap 受控编辑器
 *
 * 职责边界（严格单一）：
 * - **只做编辑**：接收 markdown 初始源码 → 客户端解析为文档树 → 用户就地编辑 →
 *   通过 onChange(markdown) 上抛最新源码。不含任何网络请求 / 保存 / DOM 副作用。
 * - 网络 / 生命周期（fetch、防抖 PATCH、updatedAt、补拉 render）全部留在外层
 *   DocInlineEditor，本组件不感知。
 *
 * 设计要点：
 * - 载入：仅首次挂载时把 initialMarkdown 解析进编辑器（contentType: 'markdown'，
 *   由官方 @tiptap/markdown 扩展驱动）。此后内容变更全部由用户编辑驱动，
 *   外部 initialContent 变化不回写（与阅读页"打开即定稿"语义一致）。
 * - 输出：onUpdate 时 editor.getMarkdown() 同步最新源码（内部由 Markdown 扩展维护）。
 * - SSR：immediatelyRender:false（Astro 岛水合必需，防止编辑器在无 DOM 阶段渲染）。
 * - 扩展装配：buildDocExtensions()（见 extensions/index.ts）与 P1 保真测试共用，
 *   保证「测试覆盖的 round-trip」=「运行时行为」。
 * - 键盘：Ctrl/Cmd-S → onSave()（外层保存并退出）。
 *
 * 视觉：本组件只挂 editor 到容器；无边框/无工具条的"无框化"样式由外层
 * DocInlineEditor / [id].astro 的 doc-ie-* 类负责（阅读正文同源样式 .prose）。
 */
import { forwardRef, useCallback, useImperativeHandle } from 'react';
import type { KeyboardEvent, ReactElement, Ref } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { buildDocExtensions } from './extensions';

/** 对外句柄：供外层在需要时聚焦 / 请求当前源码 */
export interface DocTiptapEditorHandle {
  /** 聚焦编辑器（进入编辑时交还键盘） */
  focus(): void;
  /** 取当前 markdown 源码（保存/退出前最终态） */
  getMarkdown(): string;
}

export interface DocTiptapEditorProps {
  /** 初始 markdown（仅挂载时载入） */
  initialMarkdown: string;
  /** 内容变化回调（自动保存等由外层处理） */
  onChange: (markdown: string) => void;
  /** Ctrl/Cmd-S（外层通常 = 保存并退出） */
  onSave?: () => void;
  /** 无边框容器的可选样式类 */
  className?: string;
}

const DocTiptapEditor = forwardRef<DocTiptapEditorHandle, DocTiptapEditorProps>(function DocTiptapEditor(
  { initialMarkdown, onChange, onSave, className }: DocTiptapEditorProps,
  ref,
): ReactElement {
  const editor = useEditor({
    extensions: [...buildDocExtensions(), Markdown],
    content: initialMarkdown,
    // 官方 @tiptap/markdown：声明载入内容为 markdown（而非 HTML/JSON）
    contentType: 'markdown',
    // SSR 安全：Astro 岛水合阶段禁止立即渲染（客户端 mount 后才建 ProseMirror）
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // 无编辑框观感：ProseMirror 默认 outline 去掉；其余排版交给外层 .prose
        class: 'tiptap-doc focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getMarkdown());
    },
  });

  useImperativeHandle(
    ref,
    (): DocTiptapEditorHandle => ({
      focus: () => {
        editor?.commands.focus();
      },
      getMarkdown: () => editor?.getMarkdown() ?? '',
    }),
    [editor],
  );

  /** Ctrl/Cmd-S → 外层（保存并退出）。在容器层拦截，避免浏览器「另存为」 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave?.();
      }
    },
    [onSave],
  );

  return (
    <div className={className} onKeyDown={handleKeyDown}>
      {/* ProseMirror 挂载点；排版样式（.prose 变量链）由外层 doc-ie-view 容器提供 */}
      <EditorContent editor={editor} />
    </div>
  );
});

export default DocTiptapEditor;
