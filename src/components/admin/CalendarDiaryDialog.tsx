import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from './MarkdownEditor';
import { confirmDialog } from '@/lib/confirm';

type Diary = { date: string; title: string; content: string; contentHtml: string };
type OpenDetail = { date: string };

export default function CalendarDiaryDialog(): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef('');
  const titleRef = useRef('');
  const dirtyRef = useRef(false);
  const requestRef = useRef(0);
  const [date, setDate] = useState('');
  const [diary, setDiary] = useState<Diary | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [visualModule, setVisualModule] = useState<typeof import('./cm-wysiwyg') | null>(null);
  const [visualError, setVisualError] = useState(false);

  useEffect(() => {
    void import('./cm-wysiwyg').then(setVisualModule).catch(() => setVisualError(true));
  }, []);

  const readDiary = useCallback(async (day: string): Promise<Diary | null> => {
    const response = await fetch(`/api/diary?date=${encodeURIComponent(day)}`, { cache: 'no-store' });
    const payload = await response.json() as { diary: Diary | null; error?: string };
    if (!response.ok) throw new Error(payload.error || '读取日记失败');
    return payload.diary;
  }, []);

  const open = useCallback(async (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const request = ++requestRef.current;
    setDate(day);
    setDiary(null);
    setEditing(false);
    setLoading(true);
    setMessage('');
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    try {
      let next = await readDiary(day);
      let created = false;
      if (!next) {
        const response = await fetch('/api/diary', {
          method: 'PUT', headers: { 'content-type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ date: day }),
        });
        if (!response.ok) throw new Error('创建日记失败');
        created = (await response.json() as { created: boolean }).created;
        next = await readDiary(day);
      }
      if (request !== requestRef.current || !next) return;
      contentRef.current = next.content;
      titleRef.current = next.title;
      dirtyRef.current = false;
      setDiary(next);
      setEditing(created || !next.content.trim());
      if (created) window.dispatchEvent(new CustomEvent('diary:changed'));
    } catch (error) {
      if (request === requestRef.current) setMessage(error instanceof Error ? error.message : '读取日记失败');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [readDiary]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      (window as typeof window & { __diaryPending?: OpenDetail }).__diaryPending = undefined;
      void open((event as CustomEvent<OpenDetail>).detail.date);
    };
    window.addEventListener('diary:open', onOpen);
    const pending = (window as typeof window & { __diaryPending?: OpenDetail }).__diaryPending;
    if (pending) {
      (window as typeof window & { __diaryPending?: OpenDetail }).__diaryPending = undefined;
      void open(pending.date);
    }
    const params = new URLSearchParams(location.search);
    if (params.get('open') === 'diary' && params.get('date')) void open(params.get('date')!);
    return () => window.removeEventListener('diary:open', onOpen);
  }, [open]);

  const close = useCallback(async () => {
    if (saving) return;
    if (dirtyRef.current && !(await confirmDialog('日记尚未保存，确定关闭吗？', { confirmText: '不保存并关闭' }))) return;
    ++requestRef.current;
    dialogRef.current?.close();
    setEditing(false);
    setMessage('');
    dirtyRef.current = false;
  }, [saving]);

  const save = useCallback(async () => {
    if (!date || saving) return;
    setSaving(true);
    setMessage('保存中…');
    try {
      const response = await fetch('/api/diary', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ date, title: titleRef.current, content: contentRef.current }),
      });
      if (!response.ok) throw new Error('保存失败，请重试');
      const next = await readDiary(date);
      if (!next) throw new Error('保存后读取失败，请重试');
      setDiary(next);
      dirtyRef.current = false;
      setEditing(false);
      setMessage('已保存');
      window.dispatchEvent(new CustomEvent('diary:changed'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [date, readDiary, saving]);

  return <dialog data-m3-role="dialog" data-m3-module="diary" ref={dialogRef} aria-label={`${date || '每日'}日记`} onCancel={(event) => { event.preventDefault(); void close(); }}
    onClick={(event) => { if (event.target === dialogRef.current) void close(); }}
    className="m-auto max-h-[90vh] w-[min(96vw,58rem)] overflow-visible rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/55">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur sm:px-8">
      <div><p className="font-pixel text-[0.6rem] tracking-[0.2em] text-primary">DAILY DIARY</p><p className="mt-1 text-sm text-muted-foreground">{date}</p></div>
      <div className="flex items-center gap-2">
        {!editing && diary && <button type="button" onClick={() => { contentRef.current = diary.content; titleRef.current = diary.title; setEditing(true); }} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary">编辑</button>}
        {editing && <button type="button" disabled={saving} onClick={() => void save()} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">{saving ? '保存中…' : '保存日记'}</button>}
        <button type="button" onClick={() => void close()} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">关闭</button>
      </div>
    </div>
    <div className="max-h-[calc(90vh-5rem)] overflow-y-auto px-5 py-6 sm:px-8">
      {loading && <p className="text-sm text-muted-foreground">正在读取日记…</p>}
      {message && <p role="status" className="mb-3 text-sm text-primary">{message}</p>}
      {!loading && diary && (editing ? <div>
        <input key={date} aria-label="日记标题" defaultValue={diary.title} onChange={(event) => { titleRef.current = event.target.value; dirtyRef.current = true; }} maxLength={200} placeholder="日记标题（可选）" className="mb-5 w-full border-0 border-b border-border bg-transparent px-1 py-2 font-display text-2xl font-semibold outline-none focus-visible:border-primary" />
        {visualModule ? <MarkdownEditor key={date} initialContent={diary.content} onChange={(content) => { contentRef.current = content; dirtyRef.current = true; }} onSave={() => void save()} wysiwyg initialWysiwyg={visualModule} documentContextMenu variant="ghost" autoHeight className="doc-ie-view diary-inline-editor min-h-48" /> : <p className={`py-6 text-sm ${visualError ? 'text-destructive' : 'text-muted-foreground'}`}>{visualError ? '可视化编辑器加载失败，请刷新页面重试。' : '正在准备可视化编辑器…'}</p>}
      </div> : <div>
        <h3 className="font-display text-2xl font-semibold">{diary.title || `${date} 日记`}</h3>
        <article className="prose mt-6 max-w-none break-words" dangerouslySetInnerHTML={{ __html: diary.contentHtml || '<p>还没有内容，点击“编辑”开始记录。</p>' }} />
      </div>)}
    </div>
  </dialog>;
}
