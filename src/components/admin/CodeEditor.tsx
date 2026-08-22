/**
 * CodeEditor.tsx —— CodeMirror 6 编辑器封装（MDX 语法高亮）
 *
 * - 使用 `@mdx-js/language-service` 的 `mdx()` 扩展；
 * - 配色跟随站点主题：暗色 = oneDark；亮色 = 主题色 HighlightStyle + 主题化 chrome；
 * - 通过 MutationObserver 监听 html[class] 变化实时切换编辑器主题；
 * - Ctrl/Cmd-S 手动保存。
 */
import { useEffect, useRef } from 'react';
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

/** 组件 Props */
interface CodeEditorProps {
  /** 受控内容 */
  value: string;
  /** 内容变更回调 */
  onChange: (value: string) => void;
  /** 手动保存（Ctrl-S）回调 */
  onSave: () => void;
}

/** 亮色语法高亮（取自主题色板） */
const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#b3572e' },
  { tag: [tags.string, tags.special(tags.string)], color: '#5a7d3a' },
  { tag: [tags.comment, tags.blockComment], color: '#8a8378', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#2f6f8f' },
  { tag: tags.tagName, color: '#8a4b3a' },
  { tag: tags.attributeName, color: '#a06a2c' },
  { tag: tags.number, color: '#8a4b8f' },
  { tag: tags.heading, color: '#141413', fontWeight: '600' },
  { tag: [tags.link, tags.url], color: '#2f6f8f', textDecoration: 'underline' },
]);

/** 亮色编辑器 chrome（读主题令牌） */
const lightChrome = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-card)',
      color: 'var(--color-foreground)',
      height: '100%',
      fontSize: '13px',
    },
    '.cm-content': {
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      padding: '12px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-muted-foreground)',
    },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: false },
);

/** 判断当前是否为暗色 */
function editorIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** 按模式构建主题扩展 */
function buildTheme(dark: boolean): Extension[] {
  return dark ? [oneDark] : [lightChrome, syntaxHighlighting(lightHighlight)];
}

/** MDX 围栏代码语言映射（Markdown 高亮 + JS/TS/JSX 高亮） */
function codeLanguages(info: string): Language | null {
  const lang = info.trim().toLowerCase();
  if (['ts', 'typescript'].includes(lang)) return javascript({ typescript: true }).language;
  if (['tsx'].includes(lang)) return javascript({ typescript: true, jsx: true }).language;
  if (['js', 'jsx'].includes(lang)) return javascript({ jsx: true }).language;
  return null;
}

/** CodeMirror 编辑器 */
export default function CodeEditor({ value, onChange, onSave }: CodeEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // 挂载一次：创建 EditorView
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          EditorView.lineWrapping,
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            { key: 'Mod-s', run: () => { onSaveRef.current(); return true; } },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          markdown({
            base: markdownLanguage,
            codeLanguages,
          }),
          themeCompartment.current.of(buildTheme(editorIsDark())),
        ],
      }),
    });
    viewRef.current = view;

    // 站点主题切换 → 重配编辑器主题
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

  // 外部值同步（载入文章/新建）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="h-full overflow-hidden" />;
}
