/**
 * LiveEditor.tsx —— Obsidian 式单栏所见即所得写作页
 *
 * - 单栏 CodeMirror 6 + Live Preview 扩展（隐藏 Markdown 标记、块级渲染）；
 * - 顶部工具条：标题 / 类型 / 摘要 / 标签 / 删除 / 保存状态；
 * - 500ms 防抖自动保存 /api/save-draft（版本号防竞态、401 提示重登、beforeunload）；
 * - Ctrl/Cmd-S 手动保存；编辑器配色跟随站点主题。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { livePreview } from './cm-live-preview';
import type { ArticleType } from '../../../db/types';
import { ARTICLE_TYPES } from '../../../db/types';

/** 初始草稿（服务端注入） */
export interface InitialDraft {
  id: string;
  title: string;
  type: ArticleType;
  summary: string;
  tags: string[];
  content: string;
}

/** 组件 Props */
interface LiveEditorProps {
  initial: InitialDraft;
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
      padding: '16px 0',
      maxWidth: '46rem',
      margin: '0 auto',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-muted-foreground)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 4px' },
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

/** 写作页 */
export default function LiveEditor({ initial }: LiveEditorProps): ReactElement {
  const [draft, setDraft] = useState<InitialDraft>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

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

  /* ---- 删除 ---- */
  const removeCurrent = useCallback(async (): Promise<void> => {
    if (!window.confirm('确定删除这篇文章？此操作不可撤销。')) return;
    await fetch(`/api/articles/${draftRef.current.id}`, { method: 'DELETE' });
    window.location.href = '/';
  }, []);

  /* ---- CodeMirror（单栏 + Live Preview） ---- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef<(v: string) => void>(() => {});
  const onSaveRef = useRef(saveNow);
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
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            { key: 'Mod-s', run: () => { void onSaveRef.current(); return true; } },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          markdown({ base: markdownLanguage, codeLanguages }),
          livePreview(),
          themeCompartment.current.of(buildTheme(editorIsDark())),
        ],
      }),
    });
    viewRef.current = view;

    const observer = new MutationObserver(() => {
      view.dispatch({ effects: themeCompartment.current.reconfigure(buildTheme(editorIsDark())) });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值同步（仅新建/载入时触发；编辑器自身输入不重复）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== draft.content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: draft.content } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.content]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条 */}
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
            className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            删除
          </button>
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
          <span className="ml-auto text-muted-foreground">所见即所得 · Ctrl/Cmd + S 保存</span>
        </div>
      </div>

      {/* 单栏编辑器（Live Preview） */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div ref={hostRef} className="h-full" />
      </div>
    </div>
  );
}
