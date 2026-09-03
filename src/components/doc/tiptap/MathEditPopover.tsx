/**
 * MathEditPopover.tsx —— 公式节点源码就地编辑（Obsidian-like 交互）
 *
 * 触发：用户点击文档中的公式节点（inlineMath / blockMath），Tiptap Mathematics
 * 扩展的内置 NodeView 拦截点击并回调 inlineOptions.onClick / blockOptions.onClick
 * （参数：node, pos），由 DocTiptapEditor 转换为本弹层 state。
 *
 * 交互（贴近 Obsidian）：
 * - 弹出浮层（输入框 + 取消/确认），输入框预填 node.attrs.latex；
 * - Enter 或点确认 → editor.chain().updateInlineMath/updateBlockMath 更新 latex，
 *   KaTeX 重新渲染，弹层关闭；
 * - Esc / 点取消 / 点外部 → 丢弃修改，关闭。
 *
 * 定位：fixed + 视口坐标（避免滚动错位），点击瞬间用 editor.view.coordsAtPos(pos)
 * 取节点 bbox；公式靠近视口底时改悬浮在公式上方（更贴 Obsidian）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as GlobalMouseEvent,
  ReactElement,
} from 'react';

export type MathKind = 'inline' | 'block';

export interface MathEditPopoverProps {
  /** Tiptap 编辑器实例 */
  editor: Editor;
  /** 节点 ProseMirror pos（updateInlineMath/updateBlockMath 需要） */
  pos: number;
  /** 节点类型（决定用 updateInlineMath 还是 updateBlockMath） */
  kind: MathKind;
  /** 节点当前 latex（输入框预填；取消时不写回） */
  initialLatex: string;
  /** 视口坐标（点击瞬间由 editor.view.coordsAtPos 计算） */
  position: { left: number; top: number; bottom: number };
  /** 关闭（取消/Esc/外部点击） */
  onClose: () => void;
}

/** 节点 bbox 与浮层间的间距 */
const OFFSET = 6;
/** 浮层高度估算（按钮 + 输入框），用于判断上下位置 */
const POPOVER_HEIGHT = 132;

export default function MathEditPopover({
  editor,
  pos,
  kind,
  initialLatex,
  position,
  onClose,
}: MathEditPopoverProps): ReactElement {
  const [value, setValue] = useState(initialLatex);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  /** 进入即全选 + focus，便于一键重写 */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  const commit = useCallback(() => {
    const latex = value.trim();
    if (latex && latex !== initialLatex) {
      if (kind === 'inline') {
        editor.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();
      } else {
        editor.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run();
      }
    }
    onClose();
  }, [editor, kind, initialLatex, pos, value, onClose]);

  const cancel = useCallback(() => onClose(), [onClose]);

  /** Enter 提交；Shift+Enter 换行；Esc 取消 */
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    },
    [commit, cancel],
  );

  /** 外部点击关闭（用 mousedown/up 位移判断是否为 click，避开拖拽） */
  useEffect(() => {
    let downX = 0;
    let downY = 0;
    const onDown = (e: MouseEvent): void => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: MouseEvent): void => {
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-doc-math-popover="1"]')) return;
      cancel();
    };
    // setTimeout 延迟挂载，避开触发这次弹层的点击本身（同一 click 派发后 addEventListener）
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('mouseup', onUp, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
    };
  }, [cancel]);

  /** 公式靠近视口底时改悬浮在公式上方（bottom 是节点下沿视口）） */
  const spaceBelow = window.innerHeight - position.bottom;
  const placeAbove = spaceBelow < POPOVER_HEIGHT + 16 && position.top > POPOVER_HEIGHT + 16;
  const top = placeAbove ? position.top - OFFSET : position.bottom + OFFSET;
  const left = position.left;
  const transform = placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';

  return createPortal(
    <div
      data-doc-math-popover="1"
      role="dialog"
      aria-label="编辑公式"
      onMouseDown={(e: GlobalMouseEvent<HTMLDivElement>) => e.stopPropagation()}
      onClick={(e: GlobalMouseEvent<HTMLDivElement>) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-border bg-background shadow-xl ring-1 ring-foreground/10"
      style={{
        top,
        left,
        transform,
        minWidth: 240,
        maxWidth: Math.min(480, window.innerWidth - 32),
      }}
    >
      <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
        {kind === 'inline' ? '行内公式 · LaTeX 源码' : '块级公式 · LaTeX 源码'}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        rows={Math.max(2, Math.min(6, value.split('\n').length || 2))}
        className="block w-full resize-y rounded-md bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/40"
        placeholder="LaTeX 源码，如 \int_0^1 x\,dx"
      />
      <div className="flex items-center justify-end gap-1 border-t px-2 py-1.5 text-xs">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          取消
        </button>
        <button
          type="button"
          onClick={commit}
          className="rounded-md bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
        >
          确认（Enter）
        </button>
      </div>
    </div>,
    document.body,
  );
}