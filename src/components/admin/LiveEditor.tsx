/**
 * LiveEditor.tsx —— Obsidian 式写作工作区
 *
 * 三栏布局：
 * - 左栏：全部文章（按类型分组排序），支持新建 / 打开 / 删除 / 移动（改类型）；
 * - 中栏：单栏 CodeMirror + Live Preview（居中留白，不铺满）；
 * - 右栏：当前文章目录（点击跳转到对应标题）。
 * 500ms 防抖自动保存 /api/save-draft（版本防竞态、401 重登、beforeunload）；Ctrl/Cmd-S。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { searchKeymap } from '@codemirror/search';
import { livePreview } from './cm-live-preview';
import { mdKeymap } from './md-keymap';
import type { ArticleType } from '../../../db/types';
import { ARTICLE_TYPES } from '../../../db/types';

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

/* ---- CodeMirror 主题（跟随站点主题） ---- */
const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#b3572e' },
  { tag: [tags.string, tags.special(tags.string)], color: '#5a7d3a' },
  { tag: [tags.comment, tags.blockComment], color: '#8a8378', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#2f6f8f' },
  { tag: tags.tagName, color: '#8a4b3a' },
  { tag: tags.attributeName, color: '#a06a2c' },
  { tag: tags.number, color: '#8a4b8f' },
  { tag: [tags.link, tags.url], color: '#2f6f8f', textDecoration: 'underline' },
]);

const lightChrome = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-card)',
      color: 'var(--color-foreground)',
      height: '100%',
      fontSize: '14px',
    },
    '.cm-content': {
      fontFamily: 'var(--font-sans-family)',
      padding: '20px 8px',
      maxWidth: '44rem',
      margin: '0 auto',
      fontSize: '15px',
      lineHeight: '1.8',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-muted-foreground)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '2px 4px' },
  },
  { dark: false },
);

function editorIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

function buildTheme(dark: boolean): Extension[] {
  return dark ? [oneDark] : [lightChrome, syntaxHighlighting(lightHighlight)];
}

function codeLanguages(info: string): Language | null {
  const lang = info.trim().toLowerCase();
  if (['ts', 'typescript'].includes(lang)) return javascript({ typescript: true }).language;
  if (['tsx'].includes(lang)) return javascript({ typescript: true, jsx: true }).language;
  if (['js', 'jsx'].includes(lang)) return javascript({ jsx: true }).language;
  return null;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

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

  /* ---- CodeMirror（单栏 + Live Preview） ---- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef<(v: string) => void>(() => {});
  const onSaveRef = useRef(saveNow);
  const onPasteRef = useRef<(e: ClipboardEvent) => boolean>(() => false);
  const onDropRef = useRef<(e: DragEvent) => void>(() => {});
  onSaveRef.current = saveNow;
  onChangeRef.current = (v) => update('content', v);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: draftRef.current.content,
        extensions: [
          lineNumbers(),
          drawSelection(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            { key: 'Mod-s', run: () => { void onSaveRef.current(); return true; } },
          ]),
          mdKeymap,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          // 粘贴图片/图片 URL、输入全角反引号自动转 ASCII
          EditorView.domEventHandlers({
            paste: (event) => onPasteRef.current(event),
            beforeinput: (event, v) => {
              const e = event as InputEvent;
              if (
                e.inputType === 'insertText' &&
                !e.isComposing &&
                e.data &&
                /[\uFF40\u02CB\u2035]/.test(e.data)
              ) {
                e.preventDefault();
                const text = e.data.replace(/[\uFF40\u02CB\u2035]/g, '`');
                v.dispatch({
                  changes: {
                    from: v.state.selection.main.from,
                    to: v.state.selection.main.to,
                    insert: text,
                  },
                  userEvent: 'input.type',
                });
                return true;
              }
              return false;
            },
          }),
          markdown({ base: markdownLanguage, codeLanguages }),
          livePreview(),
          themeCompartment.current.of(buildTheme(editorIsDark())),
        ],
      }),
    });
    viewRef.current = view;

    // 拖拽上传（文件 → 上传；图片 URL → Markdown）
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      host.classList.add('cm-drop-target');
    };
    const onDragLeave = (): void => {
      host.classList.remove('cm-drop-target');
    };
    const onDrop = (e: DragEvent): void => {
      host.classList.remove('cm-drop-target');
      onDropRef.current(e);
    };
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);

    const observer = new MutationObserver(() => {
      view.dispatch({ effects: themeCompartment.current.reconfigure(buildTheme(editorIsDark())) });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
      host.removeEventListener('dragover', onDragOver);
      host.removeEventListener('dragleave', onDragLeave);
      host.removeEventListener('drop', onDrop);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== draft.content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: draft.content } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.content]);

  /** 跳转目录对应标题行 */
  const jumpToHeading = useCallback((line: number): void => {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.doc.line(line + 1).from;
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  }, []);

  /** 在光标处插入文本（编辑器不可用时追加到末尾） */
  const insertAtCursor = useCallback((text: string): void => {
    const view = viewRef.current;
    if (!view) {
      update('content', `${draftRef.current.content}${text}`);
      return;
    }
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: text } });
    view.focus();
  }, [update]);

  /** 是否形如网络图片 URL（http(s) + 图片扩展名，允许查询串） */
  function isImageUrl(text: string): boolean {
    return /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?$/i.test(text.trim());
  }

  /** 从 URL 提取文件名（去扩展名/查询串，兜底 image），并清除 markdown 元字符 */
  function nameFromUrl(url: string): string {
    const clean = url.trim().split(/[?#]/)[0] ?? '';
    const seg = clean.split('/').pop() ?? '';
    const name = decodeURIComponent(seg.replace(/\.[^.]+$/, '') || 'image');
    return name.replace(/["\[\]]/g, '');
  }

  /** 上传本地图片 → /api/images → 返回可引用的 URL（401 置登录过期并抛错） */
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime, data: base64 }),
    });
    if (res.status === 401) {
      setSaveStatus('expired');
      throw new Error('LOGIN_EXPIRED');
    }
    const out = (await res.json()) as { url?: string; error?: string };
    if (!out.url) throw new Error(out.error ?? '图片上传失败');
    return out.url;
  }, [setSaveStatus]);

  /** 上传本地图片 → 在光标处插入 Markdown 图片 */
  const handleImageFile = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        const url = await uploadFile(file);
        const name = (file.name.replace(/\.[^.]+$/, '') || 'image').replace(/["\[\]]/g, '');
        insertAtCursor(`![${name}](${url})\n`);
      } catch (err) {
        if (err instanceof Error && err.message !== 'LOGIN_EXPIRED') window.alert(err.message);
      } finally {
        setUploading(false);
      }
    },
    [uploadFile, insertAtCursor],
  );

  /** 上传封面图 → 填入封面 URL 输入框 */
  const handleCoverFile = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        const url = await uploadFile(file);
        update('cover', url);
      } catch (err) {
        if (err instanceof Error && err.message !== 'LOGIN_EXPIRED') window.alert(err.message);
      } finally {
        setUploading(false);
      }
    },
    [uploadFile, update],
  );

  /** 插入网络图片：输入 URL → 生成 Markdown 引用（编辑页与查看页均可渲染） */
  const insertNetworkImage = useCallback((): void => {
    const input = window.prompt('输入网络图片 URL（https://… 以图片扩展名结尾）');
    if (!input) return;
    const url = input.trim();
    if (!isImageUrl(url)) {
      window.alert('URL 需以 http(s):// 开头并以图片扩展名结尾（png/jpg/gif/webp/avif/svg）。');
      return;
    }
    insertAtCursor(`![${nameFromUrl(url)}](${url})\n`);
  }, [insertAtCursor]);

  /** 粘贴处理：剪贴板图片文件 → 上传插入；图片 URL 文本 → 直接生成 Markdown */
  const handlePaste = useCallback(
    (event: ClipboardEvent): boolean => {
      const items = event.clipboardData?.items;
      if (!items) return false;
      const files: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        for (const f of files) void handleImageFile(f);
        return true;
      }
      const text = event.clipboardData.getData('text/plain') ?? '';
      const trimmed = text.trim();
      if (trimmed && isImageUrl(trimmed)) {
        event.preventDefault();
        insertAtCursor(`![${nameFromUrl(trimmed)}](${trimmed})\n`);
        return true;
      }
      // 普通文本粘贴：把全角/变体反引号规范化为 ASCII（与渲染管线一致）
      const normalized = text.replace(/[\uFF40\u02CB\u2035]/g, '`');
      if (normalized !== text) {
        event.preventDefault();
        const view = viewRef.current;
        if (view) {
          view.dispatch({
            changes: {
              from: view.state.selection.main.from,
              to: view.state.selection.main.to,
              insert: normalized,
            },
            userEvent: 'input.paste',
          });
        }
        return true;
      }
      return false;
    },
    [handleImageFile, insertAtCursor],
  );

  /** 拖拽处理：图片文件 → 上传插入；图片 URL → 直接生成 Markdown */
  const handleDrop = useCallback(
    (event: DragEvent): void => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        for (const f of files) void handleImageFile(f);
        return;
      }
      const uri = (
        event.dataTransfer?.getData('text/uri-list') ||
        event.dataTransfer?.getData('text/plain') ||
        ''
      )
        .split(/\r?\n/)[0]
        ?.trim();
      if (uri && isImageUrl(uri)) insertAtCursor(`![${nameFromUrl(uri)}](${uri})\n`);
    },
    [handleImageFile, insertAtCursor],
  );

  // 供 CodeMirror domEventHandlers 使用的实时引用（在定义之后赋值，避免 TDZ）
  onPasteRef.current = handlePaste;
  onDropRef.current = handleDrop;

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

      {/* 中栏：编辑器（居中留白） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 工具条 */}
        <div className="shrink-0 space-y-2 border-b bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="标题"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring"
            />
            {/* 添加图片：标题右侧、分类左侧 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImageFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
              title="插入本地图片"
              aria-label="插入本地图片"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
              </svg>
              {uploading ? '上传中…' : '图片'}
            </button>
            <button
              type="button"
              onClick={insertNetworkImage}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors duration-200 hover:border-primary hover:text-primary"
              title="插入网络图片（https://…）"
              aria-label="插入网络图片"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              网络图片
            </button>
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
            <span className="ml-auto text-muted-foreground">
              Ctrl/Cmd+B 加粗 · I 斜体 · K 链接 · Alt+H 标题 · S 保存
            </span>
          </div>
        </div>

        {/* 编辑器区：两边留白 */}
        <div className="min-h-0 flex-1 overflow-auto bg-background px-4 lg:px-10">
          <div ref={hostRef} className="h-full" />
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
