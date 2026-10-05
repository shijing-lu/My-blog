import { useMotionFeedback } from '@/components/ui/use-motion-feedback';
/** 全站随心录入口；编辑器在首次开窗时才加载，避免增加公开页面首屏体积。 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { confirmDialog } from '@/lib/confirm';
import type { MarkdownEditorHandle } from '@/components/admin/MarkdownEditor';

const MarkdownEditor = lazy(() => import('@/components/admin/MarkdownEditor'));

interface NotePayload {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

function tagsFromInput(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean))];
}

export default function QuickNoteFloat(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState('');
  const statusMotionRef = useMotionFeedback<HTMLSpanElement>(status);
  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const idRef = useRef<string | null>(null);
  const titleRef = useRef('');
  const contentRef = useRef('');
  const tagsRef = useRef('');
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number>(0);
  const changedRef = useRef(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const save = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timerRef.current);
    if (savingRef.current) return savingRef.current;
    if (!dirtyRef.current || !contentRef.current.trim()) return true;
    const task = (async () => {
      while (dirtyRef.current) {
        setStatus('保存中…');
        const version = revisionRef.current;
        const body = { title: titleRef.current.trim(), content: contentRef.current, tags: tagsFromInput(tagsRef.current) };
        try {
          const id = idRef.current;
          const response = await fetch(id ? `/api/quick-notes/${id}` : '/api/quick-notes', {
            method: id ? 'PUT' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await response.json() as { note?: NotePayload; error?: string };
          if (!response.ok || !data.note) throw new Error(data.error || '保存失败');
          idRef.current = data.note.id;
          changedRef.current = true;
          if (revisionRef.current === version) {
            dirtyRef.current = false;
            setStatus('已保存');
          } else {
            setStatus('有新修改，继续保存…');
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : '保存失败，请重试');
          return false;
        }
      }
      return true;
    })();
    savingRef.current = task;
    const ok = await task;
    savingRef.current = null;
    return ok;
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    revisionRef.current += 1;
    setStatus('未保存');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void save(); }, 900);
  }, [save]);

  const openNote = useCallback(async (id?: string) => {
    setOpen(true);
    setLoading(Boolean(id));
    setLoadError('');
    setMode('edit');
    setPreviewHtml('');
    setStatus('');
    window.clearTimeout(timerRef.current);
    dirtyRef.current = false;
    revisionRef.current = 0;
    idRef.current = id ?? null;
    titleRef.current = '';
    contentRef.current = '';
    tagsRef.current = '';
    setTitle('');
    setTagsInput('');
    setInitialContent('');
    setEditorKey((n) => n + 1);
    if (!id) return;
    try {
      const response = await fetch(`/api/quick-notes/${id}`, { cache: 'no-store' });
      const data = await response.json() as { note?: NotePayload; error?: string };
      if (!response.ok || !data.note) throw new Error(data.error || '读取失败');
      titleRef.current = data.note.title;
      contentRef.current = data.note.content;
      tagsRef.current = data.note.tags.join(', ');
      setTitle(data.note.title);
      setTagsInput(data.note.tags.join(', '));
      setInitialContent(data.note.content);
      setEditorKey((n) => n + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(async (): Promise<boolean> => {
    if (dirtyRef.current && contentRef.current.trim() && !(await save())) return false;
    window.clearTimeout(timerRef.current);
    setOpen(false);
    if (changedRef.current) {
      changedRef.current = false;
      window.dispatchEvent(new CustomEvent('quick-notes:changed'));
    }
    return true;
  }, [save]);

  const remove = useCallback(async () => {
    if (!idRef.current || !(await confirmDialog('确定删除这条随心录吗？', { danger: true, confirmText: '删除' }))) return;
    let unsaved = dirtyRef.current;
    try {
      window.clearTimeout(timerRef.current);
      if (savingRef.current) await savingRef.current;
      unsaved = dirtyRef.current;
      dirtyRef.current = false;
      const response = await fetch(`/api/quick-notes/${idRef.current}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除失败');
      dirtyRef.current = false;
      changedRef.current = true;
      await close();
    } catch {
      dirtyRef.current = unsaved;
      setStatus('删除失败，请重试');
    }
  }, [close]);

  const showPreview = useCallback(async () => {
    setMode('preview');
    setPreviewHtml('');
    setStatus('预览加载中…');
    try {
      const response = await fetch('/api/quick-notes/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: contentRef.current }),
      });
      const data = await response.json() as { html?: string; error?: string };
      if (!response.ok || typeof data.html !== 'string') throw new Error(data.error || '预览失败');
      setPreviewHtml(data.html);
      setStatus(dirtyRef.current ? '未保存' : '');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '预览失败');
    }
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      (window as typeof window & { __quickNotePending?: { id?: string } }).__quickNotePending = undefined;
      void openNote(id);
    };
    window.addEventListener('quick-notes:open', listener);
    const pending = (window as typeof window & { __quickNotePending?: { id?: string } }).__quickNotePending;
    if (pending) listener(new CustomEvent('quick-notes:open', { detail: pending }));
    return () => { window.removeEventListener('quick-notes:open', listener); window.clearTimeout(timerRef.current); };
  }, [openNote]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void close(); }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[aria-label="随心录编辑器"]');
      const focusables = [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [open]);

  if (!open) return null;
  return (
    <div data-m3-role="scrim" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:p-6" role="presentation">
      <section data-m3-role="dialog" data-m3-module="quick-notes" role="dialog" aria-modal="true" aria-label="随心录编辑器" className="motion-panel flex h-full max-h-[760px] w-full max-w-3xl flex-col overflow-hidden border border-border bg-background shadow-2xl sm:h-[min(88vh,760px)] sm:rounded-xl">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div>
            <p className="font-pixel text-[0.6rem] uppercase tracking-[0.2em] text-primary">QUICK NOTE</p>
            <h2 className="font-display text-lg font-semibold">随心录</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={async () => { if (await close() && location.pathname !== '/quick-notes') location.href = '/quick-notes'; }} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary">全部记录</button>
            <button type="button" aria-label="关闭随心录" onClick={() => void close()} className="rounded-md px-2 py-1 text-xl text-muted-foreground hover:bg-accent hover:text-foreground">×</button>
          </div>
        </header>
        {loading ? <div className="p-6 text-sm text-muted-foreground">正在打开记录…</div> : loadError ? <div className="p-6 text-sm text-destructive" role="alert">{loadError}<button type="button" onClick={() => void openNote(idRef.current ?? undefined)} className="ml-3 text-primary underline">重试</button></div> : <>
          <div className="space-y-3 border-b border-border px-4 py-3 sm:px-6">
            <input aria-label="标题（可选）" placeholder="标题（可选）" maxLength={120} value={title} onChange={(event) => { const value = event.target.value; setTitle(value); titleRef.current = value; markDirty(); }} className="w-full bg-transparent font-display text-lg outline-none placeholder:text-muted-foreground" />
            <input aria-label="标签" placeholder="标签，用逗号分隔，例如 灵感, 生活" value={tagsInput} onChange={(event) => { const value = event.target.value; setTagsInput(value); tagsRef.current = value; markDirty(); }} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            <div className="flex gap-1" role="tablist" aria-label="编辑与预览">
              <button type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')} className={`rounded-md px-3 py-1 text-xs ${mode === 'edit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>编辑</button>
              <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => void showPreview()} className={`rounded-md px-3 py-1 text-xs ${mode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>预览</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={mode === 'edit' ? 'h-full' : 'hidden'}>
              <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">编辑器加载中…</p>}>
                <MarkdownEditor ref={editorRef} key={editorKey} initialContent={initialContent} onChange={(value) => { contentRef.current = value; markDirty(); }} onSave={() => void save()} onReady={() => editorRef.current?.focus()} wysiwyg className="h-full" />
              </Suspense>
            </div>
            {mode === 'preview' && <div className="prose max-w-none px-5 py-5 sm:px-8" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <span ref={statusMotionRef} role="status" className="text-xs text-muted-foreground">{status || '支持本站 Markdown 扩展语法'}</span>
            <div className="flex items-center gap-2">
              {idRef.current && <button type="button" onClick={() => void remove()} className="rounded-md px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">删除</button>}
              <button type="button" onClick={() => void save()} className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90">保存</button>
            </div>
          </footer>
        </>}
      </section>
    </div>
  );
}
