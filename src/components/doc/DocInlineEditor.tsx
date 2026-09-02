/**
 * DocInlineEditor.tsx —— 文档文章「原地实时编辑」React 岛
 *
 * 需求：阅读页点「编辑」→ 原地进入编辑态（保持滚动位置）→ 光标/选中定位文本
 *       → 实时渲染改动效果 → 点「保存」写回后端。全程无弹窗。
 *
 * 设计要点（性能）：
 * - 左栏复用 MarkdownEditor（CodeMirror + livePreview）：**纯客户端**渲染
 *   粗体/斜体/标题/代码块/图片/链接，零网络往返，输入不卡。
 * - 右栏走已有 /api/doc/preview（服务端 renderMdx，含 remark-math + rehype-katex）
 *   渲染**数学公式**等 livePreview 不覆盖的部分；600ms 防抖 + AbortController
 *   + 序号守卫，避免大文章下请求堆积与竞态。
 * - 进入编辑时把被隐藏 <article> 的高度记为容器 min-height：文档总高不变，
 *   浏览器不夹逼 scrollY，滚动位置天然保持（再显式 scrollTo 兜底）。
 * - 保存后不 reload：就地 PATCH + 重新拉取 render，替换正文与目录。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from '@/components/admin/MarkdownEditor';
import { renderTocTreeHtml } from '@/lib/toc-tree';
import type { TocItem } from '@/lib/mdx-plugins';

/** 预览防抖（ms）：兼顾「及时看到公式效果」与「大文章不刷屏」 */
const PREVIEW_DEBOUNCE = 600;
/** 编辑器/预览区高度 */
const PANE_HEIGHT = 'min(70vh, 46rem)';

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
  const [nodeId, setNodeId] = useState('');
  const [content, setContent] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  /** 进入编辑前记录的滚动位置与被隐藏正文高度 */
  const savedScrollY = useRef(0);
  const savedHeight = useRef(0);
  /** 预览请求：序号守卫 + 可中断 */
  const previewSeq = useRef(0);
  const previewCtrl = useRef<AbortController | null>(null);

  /** 关闭编辑态：恢复正文、清理编辑态副作用 */
  const closeEditor = useCallback(() => {
    const grid = document.getElementById('doc-3col');
    if (grid) grid.setAttribute('data-editing', 'false');
    const art = document.querySelector<HTMLElement>('main article.prose');
    if (art) art.style.display = '';
    const host = hostRef.current;
    if (host) host.style.minHeight = '';
    previewCtrl.current?.abort();
    setOpen(false);
    setPreviewHtml('');
    setError(null);
    setDirty(false);
    setPhase('idle');
    // 兜底：高度变化可能已被浏览器夹逼，显式回到进入前位置
    window.scrollTo({ top: savedScrollY.current, behavior: 'auto' });
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
    setNodeId(id);
    try {
      const res = await fetch(`/api/doc/nodes/${id}`);
      const d = (await res.json().catch(() => ({}))) as { node?: { content?: string }; error?: string };
      if (!res.ok || typeof d.node?.content !== 'string') throw new Error(d.error ?? '读取正文失败');
      setContent(d.node.content);
      setDirty(false);
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

  /** 离页保护：有未保存改动时提示 */
  useEffect(() => {
    if (!open || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open, dirty]);

  /** 右栏预览：防抖 + 中断上一次 + 序号守卫 */
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const seq = ++previewSeq.current;
      previewCtrl.current?.abort();
      const ctrl = new AbortController();
      previewCtrl.current = ctrl;
      void (async () => {
        try {
          const res = await fetch('/api/doc/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: content }),
            signal: ctrl.signal,
          });
          const d = (await res.json().catch(() => ({}))) as { html?: string; error?: string };
          if (seq !== previewSeq.current) return; // 已被新请求覆盖
          setPreviewHtml(d.html ?? `<p class="text-destructive">${d.error ?? '渲染失败'}</p>`);
        } catch {
          if (!ctrl.signal.aborted) setPreviewHtml('<p class="text-destructive">渲染失败</p>');
        }
      })();
    }, PREVIEW_DEBOUNCE);
    return () => window.clearTimeout(timer);
  }, [open, content]);

  /** 保存：PATCH 正文 → 重拉 render → 就地替换正文与目录（不 reload） */
  const handleSave = useCallback(async () => {
    if (!nodeId || phase === 'saving') return;
    setPhase('saving');
    setError(null);
    try {
      const title = document.querySelector('main h1')?.textContent?.trim() ?? '';
      const res = await fetch(`/api/doc/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error('保存失败');
      const saved = (await res.json().catch(() => ({}))) as { node?: { updatedAt?: string } };
      syncNodeUpdatedAt(nodeId, saved.node?.updatedAt);
      // 保存后必须取最新：不带 v → 绕过 CDN 缓存，强制回源重渲
      const rr = await fetch(`/api/doc/nodes/${nodeId}/render`);
      const d = (await rr.json().catch(() => ({}))) as { html?: string; toc?: TocItem[]; error?: string };
      if (!rr.ok || typeof d.html !== 'string') throw new Error(d.error ?? '重新渲染失败');
      const art = document.querySelector<HTMLElement>('main article.prose');
      if (art) art.innerHTML = d.html;
      const tocWrap = document.getElementById('doc-toc-list');
      if (tocWrap && Array.isArray(d.toc)) {
        tocWrap.innerHTML = d.toc.length ? renderTocTreeHtml(d.toc) : '<p class="text-xs text-muted-foreground">无目录</p>';
      }
      setDirty(false);
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setPhase('idle');
    }
  }, [nodeId, content, phase, closeEditor]);

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
    closeEditor();
  }, [dirty, closeEditor]);

  return (
    <div ref={hostRef} className={open ? 'mt-6' : 'hidden'}>
      {open && (
        <div className="rounded-lg border border-border bg-card/40 p-2">
          {/* 工具条 */}
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={phase !== 'idle'}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {phase === 'saving' ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={phase === 'saving'}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              取消
            </button>
            {dirty && <span className="text-[0.7rem] text-muted-foreground">● 未保存</span>}
            <span className="ml-auto text-[0.7rem] text-muted-foreground">
              左：编辑（即时渲染格式）· 右：预览（含公式，{PREVIEW_DEBOUNCE}ms 防抖）
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
            /* 双栏：左编辑 / 右预览；窄屏堆叠 */
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="overflow-hidden rounded-md border border-border" style={{ height: PANE_HEIGHT }}>
                <MarkdownEditor
                  initialContent={content}
                  onChange={(v) => {
                    setContent(v);
                    setDirty(true);
                  }}
                  onSave={() => void handleSave()}
                  className="h-full"
                />
              </div>
              <div
                className="prose max-w-none overflow-auto rounded-md border border-border bg-background/60 p-4"
                style={{ height: PANE_HEIGHT }}
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-muted-foreground">预览生成中…</p>' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
