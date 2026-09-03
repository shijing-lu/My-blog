/**
 * DocTiptapEditor.tsx —— 文档就地编辑的 Tiptap 受控编辑器
 *
 * 职责边界（严格单一）：
 * - **只做编辑**：接收 markdown 初始源码 → 客户端解析为文档树 → 用户就地编辑 →
 *   通过 onChange(markdown) 上出最新源码。不含任何网络请求 / 保存 / DOM 副作用。
 * - 网络 / 生命周期（fetch、防抖 PATCH、updatedAt、补拉 render）全部留在外层
 *   DocInlineEditor，本组件不感知。
 *
 * 设计要点：
 * - 载入：仅首次挂载时把 initialMarkdown 解析进编辑器（contentType: 'markdown'，
 *   由官方 @tiptap/markdown 扩展驱动）。此后内容变更全部由用户编辑驱动，
 *   外部 initialContent 变化不回写（与阅读页"打开即定稿"语义一致）。
 * - 输出：onUpdate 时 editor.getMarkdown() 同步最新源码（内部由 Markdown 扩展维护）。
 * - SSR：immediatelyRender:false（Astro 岛水合必需，防止编辑器在无 DOM 阶段渲染）。
 * - 扩展装配：buildDocExtensionsWith()（见 extensions/index.ts）与 P1 保真测试共用
 *   同一事实源（测试路径不传 onMathClick）。
 * - 公式点击交互（Obsidian 风格）：Mathematics 扩展的 onClick → 本组件 React 状态
 *   渲染 MathEditPopover（fixed 视口定位 + LaTeX 源码输入框 + Enter 提交/Esc 取消/
 *   点击外部关闭）。完全替代 CodeMirror 时代"鼠标无法进入公式节点"的体验。
 * - 键盘：Ctrl/Cmd-S → onSave()（外层保存并退出）。
 *
 * 视觉：本组件只挂 editor 到容器；无边框/无工具条的"无框化"样式由外层
 * DocInlineEditor / [id].astro 的 doc-ie-* 类负责（阅读正文同源样式 .prose）。
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { buildDocExtensionsWith } from './extensions';
import MathEditPopover, { type MathKind } from './MathEditPopover';

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

/** 公式弹层 state（任一字段为 null 即不显示） */
interface MathEditState {
  editor: Editor;
  pos: number;
  kind: MathKind;
  initialLatex: string;
  position: { left: number; top: number; bottom: number };
}

const DocTiptapEditor = forwardRef<DocTiptapEditorHandle, DocTiptapEditorProps>(function DocTiptapEditor(
  { initialMarkdown, onChange, onSave, className }: DocTiptapEditorProps,
  ref,
): ReactElement {
  /** 用 ref 引用 editor，让 onMathClick 闭包（创建编辑器时）能取到运行时实例 */
  const editorRef = useRef<Editor | null>(null);
  /** 公式弹层 state：null = 不显示 */
  const [mathEdit, setMathEdit] = useState<MathEditState | null>(null);

  /**
   * 公式点击回调：闭包在编辑器创建时定义（editorRef 当时为 null），
   * 但点击事件在编辑器就绪后才触发，editorRef.current 已被 onCreate 赋值。
   */
  const handleMathClick = useCallback(
    (node: { attrs: { latex?: string } }, pos: number, kind: MathKind) => {
      const ed = editorRef.current;
      if (!ed) return;
      const latex = node.attrs.latex ?? '';
      const coords = ed.view.coordsAtPos(pos);
      if (!coords) return;
      setMathEdit({
        editor: ed,
        pos,
        kind,
        initialLatex: latex,
        position: { left: coords.left, top: coords.top, bottom: coords.bottom },
      });
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      // 传入 onMathClick：点击节点进入源码编辑（Observable 交互）
      ...buildDocExtensionsWith({ onMathClick: handleMathClick }),
      Markdown,
    ],
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
    onCreate: ({ editor: e }) => {
      editorRef.current = e;
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getMarkdown());
    },
  });

  useImperativeHandle(
    ref,
    (): DocTiptapEditorHandle => ({
      focus: () => {
        // 浏览器的 Element.focus() 默认会把焦点元素滚到视口内（破坏「进入编辑保持原阅读位置」承诺）。
        // 双保险：preventScroll 选项拦截浏览器行为 + 保存恢复 scrollY 兜住 ProseMirror 内部滚动路径。
        const view = editor?.view;
        const dom = view?.dom as HTMLElement | undefined;
        const y0 = window.scrollY;
        dom?.focus({ preventScroll: true });
        if (window.scrollY !== y0) window.scrollTo({ top: y0, behavior: 'auto' });
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
      {mathEdit && (
        <MathEditPopover
          editor={mathEdit.editor}
          pos={mathEdit.pos}
          kind={mathEdit.kind}
          initialLatex={mathEdit.initialLatex}
          position={mathEdit.position}
          onClose={() => setMathEdit(null)}
        />
      )}
    </div>
  );
});

export default DocTiptapEditor;