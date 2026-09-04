/**
 * MarkdownEditor.tsx —— 可复用的 CodeMirror 所见即所得编辑器（React 岛）
 *
 * 由文章写作台（LiveEditor）抽取：Obsidian 式单栏 Live Preview
 * （隐藏 Markdown 标记 + 代码块/图片实时渲染），内置图片上传/网络图片按钮、
 * 剪贴板粘贴/拖拽上传、主题联动；供文章与日记等场景复用。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { nthHeading, normHeadingText } from '../../lib/heading-index';
import type { Language } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { searchKeymap } from '@codemirror/search';
import { livePreview } from './cm-live-preview';
import { mdKeymap } from './md-keymap';
import { compressImageForUpload } from '../../lib/client-image-upload';

/** 对外暴露的编辑器句柄 */
export interface MarkdownEditorHandle {
  /** 在光标处插入文本（无焦点时追加到末尾） */
  insertAtCursor(text: string): void;
  /** 跳转到指定行（0 起，用于目录定位） */
  jumpToLine(line: number): void;
  /**
   * 跳到第 nth 个（0 起）level 级标题（目录点击定位用）。
   * 映射用「序列对齐」：目录项顺序 = 渲染管线标题序列，语法树扫描源码得到同一文档的
   * 标题序列，同 level 各自第 N 个一一对应——不依赖 slug/文本，重名与数学标题免疫。
   * expectText 仅作一致性校验（不一致 console.warn，仍按序号跳转）。返回是否命中。
   */
  jumpToHeading(level: number, nth: number, expectText?: string): boolean;
  /** 获取当前选中的文本（无选区返回空串；供「加入导图引用」用） */
  getSelectionText(): string;
  /** 聚焦编辑器（就地编辑进入时把光标交还给用户） */
  focus(): void;
}

/** 组件 Props */
interface MarkdownEditorProps {
  /** 初始内容（后续外部变化也会同步到编辑器） */
  initialContent: string;
  /** 内容变化回调（供外层保存/状态同步） */
  onChange?: (content: string) => void;
  /** Ctrl/Cmd-S 触发（外层保存逻辑） */
  onSave?: () => void;
  /** 容器额外样式类 */
  className?: string;
  /**
   * 单栏所见即所得模式（Obsidian 即时渲染式）：
   * - 启用后用 cm-wysiwyg 扩展替代 livePreview（数学公式 KaTeX 实时渲染 +
   *   列表圆点/数字/checkbox widget + 标题/引用内行内标记渲染）；
   * - 隐藏行号（所见即所得下行号是噪音）；
   * - 与 livePreview 互斥：两者都提供 decorations，叠加会装饰重叠。
   */
  wysiwyg?: boolean;
  /**
   * 视觉变体：
   * - 'panel'（默认）：写作台卡片式外观（`--color-card` 面板背景 + 内容限宽
   *   44rem 居中 + 图片工具条），供 /admin 等独立编辑页使用；
   * - 'ghost'：就地编辑外观（Obsidian 式）——透明背景融入阅读正文、内容宽度
   *   不设限（跟随宿主列宽）、隐藏图片工具条（图片走粘贴/拖拽），供文档详情页
   *   原位编辑使用。两种模式共用同一 CM 内核与 wysiwyg 装饰。
   */
  variant?: 'panel' | 'ghost';
}

/** CodeMirror 主题（跟随站点主题） */
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

/** ghost（就地编辑）：透明融入正文、内容宽度跟随宿主列、字号/行高对齐 prose */
const ghostChrome = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--color-foreground)',
      height: '100%',
      fontSize: '15px',
    },
    '.cm-content': {
      fontFamily: 'var(--font-sans-family)',
      padding: '0.125rem 0.25rem 0.5rem',
      maxWidth: 'none',
      margin: '0',
      fontSize: '1.0625rem',
      lineHeight: '1.9',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0' },
  },
  { dark: false },
);

function editorIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

function buildTheme(dark: boolean, ghost: boolean): Extension[] {
  if (ghost) {
    // 就地编辑：透明背景（阅读正文同底）；暗色下只取语法高亮色板，不引入深色面板底
    return [ghostChrome, syntaxHighlighting(dark ? oneDarkHighlightStyle : lightHighlight)];
  }
  return dark ? [oneDark] : [lightChrome, syntaxHighlighting(lightHighlight)];
}

function codeLanguages(info: string): Language | null {
  const lang = info.trim().toLowerCase();
  if (['ts', 'typescript'].includes(lang)) return javascript({ typescript: true }).language;
  if (['tsx'].includes(lang)) return javascript({ typescript: true, jsx: true }).language;
  if (['js', 'jsx'].includes(lang)) return javascript({ jsx: true }).language;
  return null;
}

/** 是否形如网络图片 URL */
function isImageUrl(text: string): boolean {
  return /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?$/i.test(text.trim());
}

/** 从 URL 提取文件名并清除 markdown 元字符 */
function nameFromUrl(url: string): string {
  const clean = url.trim().split(/[?#]/)[0] ?? '';
  const seg = clean.split('/').pop() ?? '';
  const name = decodeURIComponent(seg.replace(/\.[^.]+$/, '') || 'image');
  return name.replace(/["\[\]]/g, '');
}

/**
 * 可复用所见即所得编辑器
 */
const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { initialContent, onChange, onSave, className, wysiwyg = false, variant = 'panel' },
  ref,
): ReactElement {
  const ghost = variant === 'ghost';
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  /** wysiwyg 装饰扩展的注入位：模块动态加载完成后 reconfigure（见初始化 effect） */
  const wysiwygCompartment = useRef(new Compartment());
  const onChangeRef = useRef<(v: string) => void>(() => {});
  const onSaveRef = useRef<(() => void) | undefined>(undefined);
  const onPasteRef = useRef<(e: ClipboardEvent) => boolean>(() => false);
  const onDropRef = useRef<(e: DragEvent) => void>(() => {});
  const contentRef = useRef(initialContent);
  contentRef.current = initialContent;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  onChangeRef.current = (v) => onChange?.(v);
  onSaveRef.current = onSave;

  /** 上传本地图片 → /api/images → URL（自动压缩避免超 Vercel 4.5MB 限制） */
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const { base64, mime } = await compressImageForUpload(file);
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime, data: base64 }),
    });
    if (!res.ok) throw new Error('图片上传失败');
    const out = (await res.json()) as { url?: string; error?: string };
    if (!out.url) throw new Error(out.error ?? '图片上传失败');
    return out.url;
  }, []);

  /** 在光标处插入文本 */
  const insertAtCursor = useCallback((text: string): void => {
    const view = viewRef.current;
    if (!view) {
      contentRef.current = `${contentRef.current}${text}`;
      return;
    }
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: text } });
    view.focus();
  }, []);

  /** 跳转到指定行（目录定位用） */
  const jumpToLine = useCallback((line: number): void => {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.doc.line(line + 1).from;
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  }, []);

  /**
   * 跳到第 nth 个（0 起）level 级标题（目录点击定位）。
   * 映射由 src/lib/heading-index.ts 提供（语法树扫描 + 序列对齐）。
   */
  const jumpToHeading = useCallback(
    (level: number, nth: number, expectText?: string): boolean => {
      const view = viewRef.current;
      if (!view) return false;
      const hit = nthHeading(view.state, level, nth);
      if (!hit) return false;
      if (expectText !== undefined && normHeadingText(expectText) !== normHeadingText(hit.text)) {
        // 序列可能已漂移（编辑期间增删标题）：仍按序号跳转，仅告警便于发现目录不同步
        console.warn('[MarkdownEditor] 目录项与源码标题不一致（仍按序号跳转）', {
          expectText,
          actual: hit.text,
        });
      }
      jumpToLine(view.state.doc.lineAt(hit.pos).number - 1);
      return true;
    },
    [jumpToLine],
  );

  /** 获取当前选中的文本（思维导图引用用） */
  const getSelectionText = useCallback((): string => {
    const view = viewRef.current;
    if (!view) return '';
    const sel = view.state.selection.main;
    if (sel.empty) return '';
    return view.state.sliceDoc(sel.from, sel.to).trim();
  }, []);

  /** 聚焦编辑器（就地编辑进入时把光标交还给用户） */
  const focusEditor = useCallback((): void => {
    viewRef.current?.focus();
  }, []);

  useImperativeHandle(
    ref,
    () => ({ insertAtCursor, jumpToLine, jumpToHeading, getSelectionText, focus: focusEditor }),
    [insertAtCursor, jumpToLine, jumpToHeading, getSelectionText, focusEditor],
  );

  /** 上传图片并插入 Markdown */
  const handleImageFile = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        const url = await uploadFile(file);
        const name = (file.name.replace(/\.[^.]+$/, '') || 'image').replace(/["\[\]]/g, '');
        insertAtCursor(`![${name}](${url})\n`);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '图片上传失败');
      } finally {
        setUploading(false);
      }
    },
    [uploadFile, insertAtCursor],
  );

  /** 插入网络图片：输入 URL → Markdown */
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

  /** 粘贴：图片文件 → 上传插入；图片 URL → Markdown；普通文本反引号规范化 */
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
      const normalized = text.replace(/[\uFF40\u02CB\u2035]/g, '`');
      if (normalized !== text) {
        event.preventDefault();
        const view = viewRef.current;
        if (view) {
          view.dispatch({
            changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: normalized },
            userEvent: 'input.paste',
          });
        }
        return true;
      }
      return false;
    },
    [handleImageFile, insertAtCursor],
  );

  /** 拖拽：图片文件 → 上传插入；图片 URL → Markdown */
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

  onPasteRef.current = handlePaste;
  onDropRef.current = handleDrop;

  /* ---- CodeMirror 初始化 ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ghostMode = ghost;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: contentRef.current,
        extensions: [
          // WYSIWYG 模式隐藏行号（所见即所得下行号是视觉噪音）
          ...(wysiwyg ? [] : [lineNumbers()]),
          drawSelection(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          mdKeymap,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste: (event) => onPasteRef.current(event),
            beforeinput: (event, v) => {
              const e = event as InputEvent;
              if (e.inputType === 'insertText' && !e.isComposing && e.data && /[\uFF40\u02CB\u2035]/.test(e.data)) {
                e.preventDefault();
                const text = e.data.replace(/[\uFF40\u02CB\u2035]/g, '`');
                v.dispatch({
                  changes: { from: v.state.selection.main.from, to: v.state.selection.main.to, insert: text },
                  userEvent: 'input.type',
                });
                return true;
              }
              return false;
            },
          }),
          markdown({ base: markdownLanguage, codeLanguages }),
          // 装饰扩展互斥：wysiwyg 模块动态加载后注入（见下方 import('./cm-wysiwyg')），
          // 写作台等非 wysiwyg 场景零 katex 负担；livePreview 为写作台轻量版
          wysiwyg ? wysiwygCompartment.current.of([]) : livePreview(),
          themeCompartment.current.of(buildTheme(editorIsDark(), ghostMode)),
        ],
      }),
    });
    viewRef.current = view;

    // WYSIWYG：懒加载 cm-wysiwyg 模块（内含静态 import katex，构建进独立 chunk）→
    // reconfigure 注入装饰扩展，公式/列表/行内标记即刻渲染。勿改回静态 import 或
    // import('katex')：前者让写作台（非 wysiwyg）也拉 katex，后者在 vite dev 下挂起。
    if (wysiwyg) {
      void import('./cm-wysiwyg')
        .then((m) => {
          if (!viewRef.current) return;
          viewRef.current.dispatch({ effects: wysiwygCompartment.current.reconfigure(m.wysiwygPreview()) });
        })
        .catch(() => {
          /* wysiwyg 模块加载失败：保持源码模式（最坏等价于无装饰，绝不白屏） */
        });
    }

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
      view.dispatch({ effects: themeCompartment.current.reconfigure(buildTheme(editorIsDark(), ghostMode)) });
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

  /* 外部内容变化 → 同步到编辑器 */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== initialContent) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: initialContent } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent]);

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ''}`}>
      {/* 工具条：图片上传 + 网络图片（ghost 就地编辑隐藏——图片走粘贴/拖拽） */}
      {!ghost && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5">
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
            title="插入本地图片"
            aria-label="插入本地图片"
          >
            {uploading ? '上传中…' : '图片'}
          </button>
          <button
            type="button"
            onClick={insertNetworkImage}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors duration-200 hover:border-primary hover:text-primary"
            title="插入网络图片"
            aria-label="插入网络图片"
          >
            网络图片
          </button>
          <span className="ml-auto text-[0.65rem] text-muted-foreground">
            Ctrl/Cmd+B 加粗 · I 斜体 · K 链接 · Alt+H 标题 · S 保存
          </span>
        </div>
      )}
      {/* 编辑器区：panel 模式给卡片底色 + 横向留白；ghost 透明、宽度跟随宿主（正文同宽） */}
      <div className={ghost ? 'min-h-0 flex-1 overflow-auto' : 'min-h-0 flex-1 overflow-auto bg-background px-4 lg:px-10'}>
        <div ref={hostRef} className="h-full" />
      </div>
    </div>
  );
});

export default MarkdownEditor;
