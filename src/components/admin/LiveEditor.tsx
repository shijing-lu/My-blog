/**
 * LiveEditor.tsx —— Obsidian 式写作工作区
 *
 * 三栏布局：
 * - 左栏：全部文章（按类型分组排序），支持新建 / 打开 / 删除 / 移动（改类型）；
 * - 中栏：MarkdownEditor（CodeMirror + Live Preview 所见即所得，复用组件）；
 * - 右栏：当前文章目录（点击跳转到对应标题）。
 * 500ms 防抖自动保存 /api/save-draft（版本防竞态、401 重登、beforeunload）；Ctrl/Cmd-S。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import MindMapEditor from '../mindmap/MindMapEditor';
import type { ArticleType } from '../../../db/types';
import { ARTICLE_TYPES } from '../../../db/types';
import { compressImageForUpload } from '../../lib/client-image-upload';

/** 初始草稿（服务端注入） */
export interface InitialDraft {
  id: string;
  title: string;
  type: ArticleType;
  summary: string;
  cover: string;
  tags: string[];
  content: string;
}

/** 文章元信息（左栏列表） */
export interface ArticleMeta {
  id: string;
  title: string;
  type: ArticleType;
  updatedAt: string;
}

/** 组件 Props */
interface LiveEditorProps {
  initial: InitialDraft;
  articles: ArticleMeta[];
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

/** 从 Markdown 提取标题（行号供 CM 定位） */
function extractToc(md: string): Array<{ text: string; line: number; level: number }> {
  const out: Array<{ text: string; line: number; level: number }> = [];
  md.split('\n').forEach((line, idx) => {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ text: m[2]!, line: idx, level: m[1]!.length });
  });
  return out;
}

/** 写作工作区 */
export default function LiveEditor({ initial, articles }: LiveEditorProps): ReactElement {
  const [draft, setDraft] = useState<InitialDraft>(initial);
  const [list, setList] = useState<ArticleMeta[]>(articles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  // 导图面板（边写文章边编辑思维导图）
  const [mapOpen, setMapOpen] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ id: string; title: string; data: string } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<number | null>(null);
  const versionRef = useRef(0);

  /* ---- 保存 ---- */
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
        setLastSaved(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        const d = draftRef.current;
        setList((prev) => {
          const exists = prev.some((x) => x.id === d.id);
          const item: ArticleMeta = { id: d.id, title: d.title || '未命名', type: d.type, updatedAt: new Date().toISOString() };
          return exists ? prev.map((x) => (x.id === d.id ? item : x)) : [...prev, item];
        });
      }
    } catch {
      if (v === versionRef.current) setSaveStatus('error');
    }
  }, []);

  const scheduleSave = useCallback((): void => {
    setSaveStatus('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNow();
    }, 500);
  }, [saveNow]);

  const update = useCallback(
    <K extends keyof InitialDraft>(key: K, value: InitialDraft[K]): void => {
      setDraft((d) => ({ ...d, [key]: value }));
      scheduleSave();
    },
    [scheduleSave],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (saveStatus === 'dirty' || saveStatus === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  /** 导图面板：打开时加载该文章的思维导图（无则显示创建入口） */
  useEffect(() => {
    if (!mapOpen) return;
    let cancelled = false;
    setMapLoading(true);
    setMapError('');
    void (async () => {
      try {
        const res = await fetch(`/api/mindmaps?articleId=${encodeURIComponent(draft.id)}`);
        const d = (await res.json()) as { maps?: { id: string; title: string }[] };
        const list = d.maps ?? [];
        if (list.length > 0) {
          const full = await fetch(`/api/mindmaps/${list[0]!.id}`);
          const fd = (await full.json()) as { map?: { id: string; title: string; data: unknown } };
          if (fd.map && !cancelled) {
            setMapInfo({ id: fd.map.id, title: fd.map.title, data: JSON.stringify(fd.map.data) });
          }
        } else if (!cancelled) {
          setMapInfo(null);
        }
      } catch {
        if (!cancelled) setMapError('加载思维导图失败');
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapOpen, draft.id]);

  /** 为当前文章创建思维导图 */
  const createMap = useCallback(async (): Promise<void> => {
    setMapLoading(true);
    setMapError('');
    try {
      const res = await fetch('/api/mindmaps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: draftRef.current.title || '思维导图', articleId: draftRef.current.id }),
      });
      const d = (await res.json()) as { map?: { id: string; title: string } };
      if (!res.ok || !d.map) {
        setMapError('创建失败，请重试');
        return;
      }
      const full = await fetch(`/api/mindmaps/${d.map.id}`);
      const fd = (await full.json()) as { map?: { id: string; title: string; data: unknown } };
      if (fd.map) setMapInfo({ id: fd.map.id, title: fd.map.title, data: JSON.stringify(fd.map.data) });
    } catch {
      setMapError('创建失败，请重试');
    } finally {
      setMapLoading(false);
    }
  }, []);

  /** 从编辑器选中文本添加引用节点（snippet 引用，无锚点；发布后按文本匹配定位） */
  const addRefFromEditor = useCallback(async (): Promise<void> => {
    const text = editorRef.current?.getSelectionText() ?? '';
    if (!text) {
      window.alert('请先在编辑器里选中一段文字，再点「＋ 引用选区」');
      return;
    }
    if (!mapInfo) {
      window.alert('请先创建思维导图');
      return;
    }
    const name = window.prompt('引用名称（节点显示用，不是粘贴全文）', text.slice(0, 30));
    if (name === null) return;
    const title = name.trim();
    if (!title) return;
    setMapLoading(true);
    try {
      const res = await fetch(`/api/mindmaps/${mapInfo.id}/refs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: title, snippet: text.slice(0, 500) }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(d.error ?? '添加引用失败');
        return;
      }
      // 重新拉取数据刷新画布（initialData 变化 → 编辑器重新挂载显示新节点）
      const full = await fetch(`/api/mindmaps/${mapInfo.id}`);
      const fd = (await full.json()) as { map?: { data: unknown } };
      const nextData = fd.map?.data;
      if (nextData !== undefined) setMapInfo((prev) => (prev ? { ...prev, data: JSON.stringify(nextData) } : prev));
      window.alert('已添加引用节点');
    } catch {
      window.alert('添加引用失败');
    } finally {
      setMapLoading(false);
    }
  }, [mapInfo]);

  /* ---- 打开 / 删除 / 移动 ---- */
  const loadArticle = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { article: InitialDraft };
    setDraft({ ...data.article, cover: data.article.cover ?? '', tags: data.article.tags ?? [] });
    setSelectedId(id);
    setSaveStatus('saved');
    setLastSaved(null);
  }, []);

  const newArticle = useCallback((): void => {
    window.location.href = '/edit/new';
  }, []);

  const removeArticle = useCallback(async (id: string): Promise<void> => {
    const target = list.find((x) => x.id === id);
    if (!target) return;
    if (!window.confirm(`确定删除「${target.title}」？此操作不可撤销。`)) return;
    await fetch(`/api/articles/${id}`, { method: 'DELETE' });
    setList((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDraft({ id: crypto.randomUUID(), title: '', type: 'tech', summary: '', cover: '', tags: [], content: '' });
      setSaveStatus('idle');
      setLastSaved(null);
    }
  }, [list, selectedId]);

  const moveArticle = useCallback(async (id: string, type: ArticleType): Promise<void> => {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { article: InitialDraft };
    await fetch('/api/save-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data.article, type, tags: data.article.tags ?? [] }),
    });
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, type } : x)));
    if (selectedId === id) setDraft((d) => ({ ...d, type }));
  }, [selectedId]);

  /* ---- 封面上传 ---- */
  const handleCoverFile = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        const { base64, mime } = await compressImageForUpload(file);
        const res = await fetch('/api/images', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, mime, data: base64 }),
        });
        if (!res.ok) throw new Error('上传失败');
        const out = (await res.json()) as { url?: string; error?: string };
        if (!out.url) throw new Error(out.error ?? '上传失败');
        update('cover', out.url);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '封面上传失败');
      } finally {
        setUploading(false);
      }
    },
    [update],
  );

  /** 跳转目录对应标题行 */
  const jumpToHeading = useCallback((line: number): void => {
    editorRef.current?.jumpToLine(line);
  }, []);

  /** 当前文章目录 */
  const toc = useMemo(() => extractToc(draft.content), [draft.content]);

  /** 按类型分组（更新时间倒序） */
  const groups = useMemo(() => {
    const g: Record<ArticleType, ArticleMeta[]> = { tech: [], note: [], photo: [] };
    [...list]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .forEach((a) => g[a.type]?.push(a));
    return g;
  }, [list]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏：全部文章（按类型分组） */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <span className="pixel-chip text-muted-foreground">全部文章</span>
          <button
            type="button"
            onClick={newArticle}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90"
          >
            + 新建
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {ARTICLE_TYPES.map((type) => (
            <div key={type}>
              <div className="pixel-chip px-3 py-1 text-muted-foreground">
                ▾ {TYPE_LABELS[type]} · {groups[type]?.length ?? 0}
              </div>
              <ul className="mb-2">
                {groups[type]?.map((a) => (
                  <li key={a.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => void loadArticle(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void loadArticle(a.id);
                      }}
                      className={`group/item flex cursor-pointer items-center gap-1 px-3 py-1.5 text-sm transition-colors duration-200 ${
                        selectedId === a.id ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{a.title || '未命名'}</span>
                      <span className="hidden shrink-0 items-center gap-1 group-hover/item:flex" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={a.type}
                          onChange={(e) => void moveArticle(a.id, e.target.value as ArticleType)}
                          className="w-14 cursor-pointer rounded border border-border bg-background px-1 py-0.5 font-pixel text-[0.55rem]"
                          aria-label="移动分组"
                          title="移动分组"
                        >
                          {ARTICLE_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeArticle(a.id);
                          }}
                          className="text-destructive"
                          aria-label="删除"
                          title="删除"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* 中栏：MarkdownEditor（所见即所得） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 元信息工具条 */}
        <div className="shrink-0 space-y-2 border-b bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="标题"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring"
            />
            <select
              value={draft.type}
              onChange={(e) => update('type', e.target.value as ArticleType)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              aria-label="文章类型（移动分组）"
              title="类型 = 移动分组"
            >
              {ARTICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="pixel-chip shrink-0 text-muted-foreground">封面</span>
            <input
              value={draft.cover}
              onChange={(e) => update('cover', e.target.value)}
              placeholder="封面图 URL（留空 = 自动取正文首图）"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCoverFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => coverFileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-md border border-border px-2.5 py-1.5 transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
              title="上传封面图"
              aria-label="上传封面图"
            >
              {uploading ? '上传中…' : '上传封面'}
            </button>
            {draft.cover ? (
              <button
                type="button"
                onClick={() => update('cover', '')}
                className="text-destructive hover:underline"
                title="清除封面，回落到正文首图"
              >
                清除
              </button>
            ) : null}
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
              <span
                className={`size-1.5 rounded-full ${
                  saveStatus === 'saved'
                    ? 'bg-emerald-500'
                    : saveStatus === 'error' || saveStatus === 'expired'
                      ? 'bg-destructive'
                      : saveStatus === 'saving'
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/40'
                }`}
              />
              {STATUS_TEXT[saveStatus]}
            </span>
            {lastSaved ? <span className="text-muted-foreground">上次保存 {lastSaved}</span> : null}
            {saveStatus === 'expired' ? (
              <a href="/login?next=/admin" className="text-primary underline underline-offset-2">
                重新登录
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setMapOpen((o) => !o)}
              className={`ml-auto rounded-md border px-2.5 py-1 transition-colors duration-200 ${
                mapOpen
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
              }`}
              title="展开/收起思维导图面板"
            >
              🧭 导图
            </button>
          </div>
        </div>

        {/* 工作区：编辑器 + 思维导图 左右分栏 */}
        <div className="flex min-h-0 flex-1">
          {/* 所见即所得编辑器（复用 MarkdownEditor） */}
          <MarkdownEditor
            ref={editorRef}
            initialContent={draft.content}
            onChange={(c) => update('content', c)}
            onSave={() => void saveNow()}
            className="min-h-0 min-w-0 flex-1"
          />

          {/* 导图面板：边写文章边编辑思维导图（右栏） */}
          {mapOpen && (
            <div className="flex w-[46%] min-w-0 shrink-0 flex-col border-l">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium">思维导图</span>
                  {mapInfo && (
                    <button
                      type="button"
                      onClick={() => void addRefFromEditor()}
                      className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      title="先在编辑器选中一段文字，再点击添加引用节点"
                    >
                      ＋ 引用选区
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span className="truncate">{mapLoading ? '加载中…' : mapInfo ? mapInfo.title : '未创建'}</span>
                  <button type="button" onClick={() => setMapOpen(false)} className="transition-colors hover:text-foreground">
                    收起
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {mapLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中…</div>
                ) : mapInfo ? (
                  <MindMapEditor mapId={mapInfo.id} initialTitle={mapInfo.title} initialData={mapInfo.data} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span>{mapError || '这篇文章还没有思维导图'}</span>
                    <button
                      type="button"
                      onClick={() => void createMap()}
                      className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      + 创建思维导图
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右栏：目录 */}
      <aside className="hidden w-56 shrink-0 border-l bg-background xl:block">
        <div className="border-b px-3 py-2">
          <span className="pixel-chip text-muted-foreground">目录 / TOC</span>
        </div>
        <div className="max-h-full overflow-y-auto py-2">
          {toc.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">暂无标题 —— 用 # 开始一个标题。</p>
          ) : (
            toc.map((t, i) => (
              <button
                key={`${t.text}-${i}`}
                type="button"
                onClick={() => jumpToHeading(t.line)}
                className={`block w-full truncate px-3 py-1 text-left text-sm transition-colors duration-200 hover:bg-accent ${
                  t.level >= 3 ? 'pl-7' : ''
                }`}
              >
                {t.text}
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
