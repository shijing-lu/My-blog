/**
 * DiaryEditor.tsx —— 日记所见即所得编辑器（React 岛）
 *
 * 复用 MarkdownEditor（CodeMirror + Live Preview）：输入 `## 标题` 回车即实时
 * 渲染为二级标题；Ctrl/Cmd-S 或点「保存日记」→ POST /api/diary（upsert）。
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from './MarkdownEditor';

/** 组件 Props */
interface DiaryEditorProps {
  /** 初始正文 */
  initialContent: string;
  /** 日记日期 YYYY-MM-DD */
  date: string;
}

/** 日记编辑器 */
export default function DiaryEditor({ initialContent, date }: DiaryEditorProps): ReactElement {
  const contentRef = useRef(initialContent);
  const [status, setStatus] = useState('');

  const save = useCallback(async (): Promise<void> => {
    const titleEl = document.getElementById('diary-title') as HTMLInputElement | null;
    setStatus('保存中…');
    try {
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          title: titleEl?.value ?? '',
          content: contentRef.current,
        }),
      });
      if (!res.ok) throw new Error('保存失败');
      setStatus('✓ 已保存');
      window.setTimeout(() => setStatus(''), 2000);
    } catch {
      setStatus('保存失败，请重试');
    }
  }, [date]);

  return (
    <div>
      <MarkdownEditor
        initialContent={initialContent}
        onChange={(c) => {
          contentRef.current = c;
        }}
        onSave={() => void save()}
        className="h-[420px]"
      />
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => void save()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
        >
          保存日记
        </button>
        <span className="text-xs text-emerald-600">{status}</span>
      </div>
    </div>
  );
}
