/**
 * DocInlineEditor.tsx —— 文档文章「原地实时编辑」React 岛
 *
 * 交互（单栏所见即所得）：阅读页点「编辑」→ 原地进入编辑态（保持滚动位置）
 * → 键入当下实时渲染为最终格式（cm-wysiwyg：标题/列表/粗斜/代码块/图片/
 *   数学公式 KaTeX，光标处显示源码、移出即渲染）→ 自动保存（1.5s 防抖）。
 * 全程无弹窗、无双栏、无需手动预览。
 *
 * 设计要点（性能）：
 * - 编辑器复用 MarkdownEditor（wysiwyg 模式）：**纯客户端**渲染，零网络往返，
 *   输入不卡；cm-wysiwyg 模块（含 katex）由编辑器按需动态加载，写作台零负担。
 * - 进入编辑时把被隐藏 <article> 的高度记为容器 min-height：文档总高不变，
 *   浏览器不夹逼 scrollY，滚动位置天然保持（再显式 scrollTo 兜底）。
 * - 自动保存只 PATCH（编辑态正文隐藏，渲染结果暂时用不到）；关闭编辑器时
 *   若本会话保存过 → 后台补拉 /render 就地替换正文与目录（不 reload）。
 * - 保存互斥锁（savingRef）避免并发 PATCH 导致 updatedAt 回退写错缓存版本号。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from '@/components/admin/MarkdownEditor';
import { renderTocTreeHtml } from '@/lib/toc-tree';
import type { TocItem } from '@/lib/mdx-plugins';

/** 自动保存防抖（ms）：停顿 1.5s 即静默 PATCH */
const AUTOSAVE_DEBOUNCE = 1500;
/** 编辑器单栏高度：几乎占满一屏（阅读态正文隐藏，空间全部让给编辑器） */
const PANE_HEIGHT = 'calc(100vh - 9rem)';

declare global {
  interface Window {
    /** 供 .astro 页面脚本调用（ClientRouter SPA 下会重新挂载，故用 window 桥接） */
    __docInlineEditor?: { open: () => void };
  }
}

/** 读取当前激活文章 id（左栏切换文章后会变，故每次 open 时现读） */
function readActiveNodeId(): string {
  return document.getElementById('doc-detail-data')?.getAttribute('data-active-node') ?? '';
}

/**
 * 保存后把新的 updatedAt 写回页面注入数据。
 *
 * 必须做：updatedAt 是 /render 的 CDN 缓存版本号。若不同步，切换文章时
 * 仍带旧 v 请求 → 命中 CDN 上缓存的**旧正文**，表现为「改了却没变」。
 * 解析失败时静默忽略：最坏情况是不带版本回源重渲，不会拿到错误内容。
 */
function syncNodeUpdatedAt(id: string, updatedAt?: string): void {
  if (!updatedAt) return;
  const dataEl = document.getElementById('doc-detail-data');
  if (!dataEl) return;
  try {
    const arr = JSON.parse(dataEl.dataset.nodes ?? '[]') as Array<{ id: string; updatedAt?: string }>;
    const hit = arr.find((n) => n.id === id);
    if (!hit) return;
    hit.updatedAt = updatedAt;
    dataEl.dataset.nodes = JSON.stringify(arr);
  } catch {
    /* 忽略 */
  }
}

export default function DocInlineEditor(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');

  /** 进入编辑前记录的滚动位置与被隐藏正文高度 */
  const savedScrollY = useRef(0);
  const savedHeight = useRef(0);
  /** 当前编辑的文章 id（ref：closeEditor 异步路径里取最新值） */
  const nodeIdRef = useRef('');
  /** 最新正文（saveCore 直接读 ref，避免闭包陈旧内容覆盖新输入） */
  const contentRef = useRef('');
  contentRef.current = content;
  /** 未保存标记（state 供 UI，ref 供异步保存逻辑） */
  const dirtyRef = useRef(false);
  /** 本会话是否成功保存过（决定关闭时是否需要补拉 render） */
  const savedRef = useRef(false);
  /** 自动保存定时器 + 保存互斥锁（防并发 PATCH 把 updatedAt 写旧） */
  const saveTimer = useRef(0);
  const savingRef = useRef(false);

  /** 后台补拉 /render 并就地替换正文与目录（关闭编辑器后调用，不阻塞 UI） */
  const refreshRendered = useCallback((id: string) => {
    void (async () => {
      try {
        // 不带 v → 绕过 CDN 缓存，强制回源重渲
        const rr = await fetch(`/api/doc/nodes/${id}/render`);
        const d = (await rr.json().catch(() => ({}))) as { html?: string; toc?: TocItem[]; error?: string };
        if (!rr.ok || typeof d.html !== 'string') return;
        const art = document.querySelector<HTMLElement>('main article.prose');
        if (art) art.innerHTML = d.html;
        const tocWrap = document.getElementById('doc-toc-list');
        if (tocWrap && Array.isArray(d.toc)) {
          tocWrap.innerHTML = d.toc.length ? renderTocTreeHtml(d.toc) : '<p class="text-xs text-muted-foreground">无目录</p>';
        }
      } catch {
        /* 刷新失败：保留旧正文，下次进入或刷新页面自然更新 */
      }
    })();
  }, []);

  /** 统一保存：PATCH 正文（互斥；返回是否成功） */
  const saveCore = useCallback(async (): Promise<boolean> => {
    const id = nodeIdRef.current;
    if (!id || savingRef.current) return false;
    savingRef.current = true;
    setPhase('saving');
    try {
      const title = document.querySelector('main h1')?.textContent?.trim() ?? '';
      const res = await fetch(`/api/doc/nodes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, content: contentRef.current }),
      });
      if (!res.ok) throw new Error('保存失败');
      const saved = (await res.json().catch(() => ({}))) as { node?: { updatedAt?: string } };
      syncNodeUpdatedAt(id, saved.node?.updatedAt);
      savedRef.current = true;
      dirtyRef.current = false;
      setDirty(false);
      setError(null);
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      return false; // dirty 保留：用户继续输入会再次触发自动保存
    } finally {
      savingRef.current = false;
      setPhase('idle');
    }
  }, []);

  /** ref 桥：闭包内始终调用最新 saveCore（避免声明顺序与陈旧闭包问题） */
  const saveCoreRef = useRef(saveCore);
  saveCoreRef.current = saveCore;

  /** 关闭编辑态：恢复正文、清理编辑态副作用（有未保存改动时先保存） */
  const closeEditor = useCallback(
    async (opts?: { discard?: boolean }) => {
      window.clearTimeout(saveTimer.current);
      if (dirtyRef.current && !opts?.discard) {
        const ok = await saveCoreRef.current();
        if (!ok) return; // 保存失败：保持编辑态，error 已提示
      }
      const grid = document.getElementById('doc-3col');
      if (grid) grid.setAttribute('data-editing', 'false');
      const art = document.querySelector<HTMLElement>('main article.prose');
      if (art) art.style.display = '';
      const host = hostRef.current;
      if (host) host.style.minHeight = '';
      setOpen(false);
      setError(null);
      setDirty(false);
      dirtyRef.current = false;
      setPhase('idle');
      // 兜底：高度变化可能已被浏览器夹逼，显式回到进入前位置
      window.scrollTo({ top: savedScrollY.current, behavior: 'auto' });
      // 本会话保存过 → 编辑期间正文已过时，后台补拉最新渲染（不阻塞关闭动作）
      const id = nodeIdRef.current;
      if (savedRef.current && id) refreshRendered(id);
    },
    [refreshRendered],
  );

  /** 编辑内容变化：标脏 + 重置自动保存定时器（防抖） */
  const handleContentChange = useCallback((v: string) => {
    setContent(v);
    dirtyRef.current = true;
    setDirty(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveCoreRef.current();
    }, AUTOSAVE_DEBOUNCE);
  }, []);

  /** 打开：拉源码 → 隐藏正文 → 撑高容器保滚动 */
  const openEditor = useCallback(async () => {
    const id = readActiveNodeId();
    if (!id) return;
    if (open) return;
    savedScrollY.current = window.scrollY;

    const art = document.querySelector<HTMLElement>('main article.prose');
    savedHeight.current = art ? art.getBoundingClientRect().height : 0;

    setPhase('loading');
    setError(null);
    nodeIdRef.current = id;
    try {
      const res = await fetch(`/api/doc/nodes/${id}`);
      const d = (await res.json().catch(() => ({}))) as { node?: { content?: string }; error?: string };
      if (!res.ok || typeof d.node?.content !== 'string') throw new Error(d.error ?? '读取正文失败');
      setContent(d.node.content);
      dirtyRef.current = false;
      setDirty(false);
      savedRef.current = false;
      setLastSavedAt('');
      if (art) art.style.display = 'none';
      const host = hostRef.current;
      if (host && savedHeight.current > 0) host.style.minHeight = `${Math.round(savedHeight.current)}px`;
      const grid = document.getElementById('doc-3col');
      if (grid) grid.setAttribute('data-editing', 'true');
      setOpen(true);
      setPhase('idle');
      window.scrollTo({ top: savedScrollY.current, behavior: 'auto' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取正文失败');
      setPhase('idle');
      setOpen(true); // 打开容器以展示错误
    }
  }, [open]);

  /** 挂载期向页面脚本暴露 open */
  useEffect(() => {
    window.__docInlineEditor = { open: () => void openEditor() };
    return () => {
      delete window.__docInlineEditor;
    };
  }, [openEditor]);

  /** 卸载清理：未决的自动保存定时器 */
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  /** 离页保护：有未保存改动时提示（自动保存不覆盖刷新/关页瞬间） */
  useEffect(() => {
    if (!open || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open, dirty]);

  /** 手动「保存」：立即保存并退出编辑态（自动保存已覆盖「编辑中不打断」场景） */
  const handleSaveAndClose = useCallback(() => {
    void (async () => {
      window.clearTimeout(saveTimer.current);
      if (dirtyRef.current) {
        const ok = await saveCoreRef.current();
        if (!ok) return; // 保存失败：留在编辑态 + error 提示
      }
      await closeEditor();
    })();
  }, [closeEditor]);

  const handleCancel = useCallback(() => {
    if (dirtyRef.current && !window.confirm('有未保存的修改（已自动保存的部分不会回退），确定放弃并关闭吗？')) return;
    void closeEditor({ discard: true });
  }, [closeEditor]);

  const saving = phase === 'saving';

  return (
    <div ref={hostRef} className={open ? 'mt-6' : 'hidden'}>
      {open && (
        <div className="rounded-lg border border-border bg-card/40 p-2">
          {/* 工具条 */}
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            <button
              type="button"
              data-testid="doc-editor-save"
              onClick={handleSaveAndClose}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              取消
            </button>
            {dirty ? (
              <span className="text-[0.7rem] text-muted-foreground">● {saving ? '自动保存中…' : '未保存（停顿后自动保存）'}</span>
            ) : lastSavedAt ? (
              <span className="text-[0.7rem] text-muted-foreground">✓ 已自动保存 {lastSavedAt}</span>
            ) : null}
            <span className="ml-auto text-[0.7rem] text-muted-foreground">
              所见即所得：##␣ 标题 · **粗体** · $x^2$ 公式 · 光标移入回显源码
            </span>
          </div>

          {error && (
            <p className="mb-2 px-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          {phase === 'loading' ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">正在读取正文…</p>
          ) : (
            /* 单栏编辑器：键入即渲染，无预览栏 */
            <div className="overflow-hidden rounded-md border border-border" style={{ height: PANE_HEIGHT }}>
              <MarkdownEditor
                initialContent={content}
                onChange={handleContentChange}
                onSave={() => handleSaveAndClose()}
                wysiwyg
                className="h-full"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
