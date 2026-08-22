/**
 * Editor.tsx —— 后台写作台主岛
 *
 * 布局：左侧文章侧栏 + 右侧（工具条 + CodeMirror / 实时预览 50/50，移动端 Tab 切换）。
 * 交互：500ms 防抖自动保存 /api/save-draft（版本号防竞态、401 提示重登、beforeunload 提醒）、
 * Ctrl-S 手动保存、「新建文章」生成新 UUID、载入/删除草稿。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ArticleType } from '../../../db/types';
import { ARTICLE_TYPES } from '../../../db/types';
import CodeEditor from './CodeEditor';
import MDXPreview from './MDXPreview';

/** 侧栏文章元信息 */
export interface AdminArticleMeta {
  id: string;
  title: string;
  type: ArticleType;
  updatedAt: string;
}

/** 组件 Props */
interface EditorProps {
  articles: AdminArticleMeta[];
}

/** 草稿状态 */
interface DraftState {
  id: string;
  title: string;
  type: ArticleType;
  summary: string;
  tags: string[];
  content: string;
}

/** 保存状态 */
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'expired';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '未开始',
  dirty: '有修改…',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  expired: '登录已过期',
};

const TYPE_LABELS: Record<ArticleType, string> = { tech: '技术', note: '笔记', photo: '摄影' };

/** 空草稿（新 UUID） */
function blankDraft(): DraftState {
  return { id: crypto.randomUUID(), title: '', type: 'tech', summary: '', tags: [], content: '' };
}

/** 短时间格式化 */
function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 写作台 */
export default function Editor({ articles }: EditorProps): ReactElement {
  const [list, setList] = useState<AdminArticleMeta[]>(articles);
  const [draft, setDraft] = useState<DraftState>(blankDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(false);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<number | null>(null);
  const versionRef = useRef(0);

  /** 立即保存当前草稿（带版本号防竞态） */
  const saveNow = useCallback(async (): Promise<void> => {
    const v = ++versionRef.current;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/save-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draftRef.current),
      });
      if (res.status === 401) {
        if (v === versionRef.current) setSaveStatus('expired');
        return;
      }
      if (!res.ok) {
        if (v === versionRef.current) setSaveStatus('error');
        return;
      }
      if (v === versionRef.current) {
        setSaveStatus('saved');
        const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        setLastSaved(now);
        // 同步侧栏标题与更新时间
        const d = draftRef.current;
        setList((prev) =>
          prev.map((item) =>
            item.id === d.id
              ? { ...item, title: d.title || '未命名', updatedAt: new Date().toISOString() }
              : item,
          ),
        );
      }
    } catch {
      if (v === versionRef.current) setSaveStatus('error');
    }
  }, []);

  /** 500ms 防抖保存 */
  const scheduleSave = useCallback((): void => {
    setSaveStatus('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNow();
    }, 500);
  }, [saveNow]);

  /** 更新草稿字段并触发防抖保存 */
  const update = useCallback(
    <K extends keyof DraftState>(key: K, value: DraftState[K]): void => {
      setDraft((d) => ({ ...d, [key]: value }));
      scheduleSave();
    },
    [scheduleSave],
  );

  // 卸载清理定时器
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  // beforeunload 提醒未保存
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (saveStatus === 'dirty' || saveStatus === 'saving') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  /** 载入草稿 */
  const loadArticle = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { article: DraftState };
      setDraft({ ...data.article, tags: data.article.tags ?? [] });
      setSelectedId(id);
      setSaveStatus('saved');
      setLastSaved(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 新建文章（新 UUID 清空编辑器） */
  const newArticle = useCallback((): void => {
    setDraft(blankDraft());
    setSelectedId(null);
    setSaveStatus('idle');
    setLastSaved(null);
  }, []);

  /** 删除当前文章 */
  const removeCurrent = useCallback(async (): Promise<void> => {
    if (!selectedId) return;
    if (!window.confirm('确定删除这篇文章？此操作不可撤销。')) return;
    await fetch(`/api/articles/${selectedId}`, { method: 'DELETE' });
    setList((prev) => prev.filter((x) => x.id !== selectedId));
    newArticle();
  }, [selectedId, newArticle]);

  return (
    <div className="flex h-full min-h-0">
      {/* 侧栏：文章列表 + 新建 */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <span className="pixel-chip text-muted-foreground">文章列表</span>
          <button
            type="button"
            onClick={newArticle}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90"
          >
            + 新建
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {list.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => void loadArticle(a.id)}
                className={`block w-full px-3 py-2 text-left transition-colors duration-200 ${
                  selectedId === a.id ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <span className="line-clamp-1 text-sm font-medium">{a.title || '未命名'}</span>
                <span className="mt-0.5 flex gap-2 font-pixel text-[0.6rem] text-muted-foreground">
                  <span>{TYPE_LABELS[a.type]}</span>
                  <span>{formatShort(a.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* 主体 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 工具条 */}
        <div className="shrink-0 space-y-2 border-b bg-background p-3">
          <div className="flex items-center gap-2">
            <input
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="标题"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <select
              value={draft.type}
              onChange={(e) => update('type', e.target.value as ArticleType)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              aria-label="文章类型"
            >
              {ARTICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void removeCurrent()}
              disabled={!selectedId}
              className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
            >
              删除
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              value={draft.summary}
              onChange={(e) => update('summary', e.target.value)}
              placeholder="摘要（列表与搜索展示）"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
            <input
              value={draft.tags.join(', ')}
              onChange={(e) => update('tags', e.target.value.split(',').map((s) => s.trim()))}
              placeholder="标签，逗号分隔"
              className="w-52 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 ${
                saveStatus === 'saved'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : saveStatus === 'error' || saveStatus === 'expired'
                    ? 'bg-destructive/10 text-destructive'
                    : saveStatus === 'saving'
                      ? 'bg-amber-500/10 text-amber-600'
                      : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className={`size-1.5 rounded-full ${saveStatus === 'saved' ? 'bg-emerald-500' : saveStatus === 'error' || saveStatus === 'expired' ? 'bg-destructive' : saveStatus === 'saving' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
              {STATUS_TEXT[saveStatus]}
            </span>
            {lastSaved ? <span className="text-muted-foreground">上次保存 {lastSaved}</span> : null}
            {saveStatus === 'expired' ? (
              <a href="/login?next=/admin" className="text-primary underline underline-offset-2">
                重新登录
              </a>
            ) : null}
            {loading ? <span className="text-muted-foreground">载入中…</span> : null}
            <span className="ml-auto text-muted-foreground">Ctrl/Cmd + S 手动保存</span>
          </div>
        </div>

        {/* 编辑/预览分栏 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b bg-background lg:hidden">
            <button
              type="button"
              onClick={() => setMobileTab('edit')}
              className={`flex-1 px-3 py-2 text-sm ${mobileTab === 'edit' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('preview')}
              className={`flex-1 px-3 py-2 text-sm ${mobileTab === 'preview' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            >
              预览
            </button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <div className={`h-full min-h-0 ${mobileTab === 'edit' ? 'block' : 'hidden lg:block'}`}>
              <CodeEditor value={draft.content} onChange={(v) => update('content', v)} onSave={() => void saveNow()} />
            </div>
            <div className={`h-full min-h-0 ${mobileTab === 'preview' ? 'block' : 'hidden lg:block'}`}>
              <MDXPreview content={draft.content} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
