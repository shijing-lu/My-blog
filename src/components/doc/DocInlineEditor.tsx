/**
 * DocInlineEditor.tsx —— 文档文章「就地实时编辑」React 岛（Obsidian 式原位编辑）
 *
 * 交互（单栏所见即所得 · 就地形态）：阅读页点「编辑」→ 文章正文原位被编辑器
 * 替换（页面不跳转、不弹独立编辑页；标题栏与整页布局保持不变）→ 键入当下实时
 * 渲染为最终格式（cm-wysiwyg：标题/列表/粗斜/代码块/图片/数学公式 KaTeX，
 * 光标处显示源码、移出即渲染）→ 自动保存（1.5s 防抖）。
 *
 * 就地形态设计：
 * - 编辑器视觉 = ghost 变体（MarkdownEditor variant="ghost"）：透明背景融入
 *   阅读正文、内容宽度跟随正文列、无独立工具条/卡片/边框 —— 页面看起来仍是
 *   「这篇文章」，只是文本可直接编辑。
 * - 高度策略（保滚动不跳）：
 *   · 正文不高于「一屏可用高」→ 编辑视口高 = 原正文高，页面总高几乎不变，
 *     阅读滚动位置天然保持（最丝滑的就地场景）；
 *   · 超长文 → 编辑视口 = 一屏可用高 + 编辑器内滚动（CM 虚拟化仍有效），进入时
 *     把视口滚动到原正文起点并把 CM 内部滚动同步到相近阅读进度，退出恢复原位置。
 * - 保存反馈收敛为一个右下小胶囊（不占文档流、不遮挡正文结构）：「完成」= 保存
 *   并退出；未保存/保存中/已保存/失败状态就近显示。另有标题旁按钮与右侧悬浮框
 *   按钮（编辑中再点 = 保存退出）两条等价退出路径。
 * - 自动保存只 PATCH（编辑态正文隐藏，渲染结果暂时用不到）；关闭编辑器时若本
 *   会话保存过 → 后台补拉 /render 就地替换正文与目录（不 reload）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from '@/components/admin/MarkdownEditor';
import type { MarkdownEditorHandle } from '@/components/admin/MarkdownEditor';
import { renderTocTreeHtml } from '@/lib/toc-tree';
import type { TocItem } from '@/lib/mdx-plugins';

/** 自动保存防抖（ms）：停顿 1.5s 即静默 PATCH */
const AUTOSAVE_DEBOUNCE = 1500;

declare global {
  interface Window {
    /** 供 .astro 页面脚本调用（ClientRouter SPA 下会重新挂载，故用 window 桥接） */
    __docInlineEditor?: { open: () => void; saveAndClose?: () => void };
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

/** 同步标题旁与右侧悬浮框的编辑入口按钮（进入编辑 → 「完成」态；退出还原） */
function syncEntryButtons(editing: boolean): void {
  const mainBtn = document.getElementById('doc-inline-edit');
  if (mainBtn) {
    mainBtn.textContent = editing ? '完成' : '编辑';
    mainBtn.title = editing ? '保存并退出编辑' : '原地编辑本文';
    mainBtn.setAttribute('aria-label', editing ? '保存并退出编辑' : '原地编辑本文');
    mainBtn.classList.toggle('doc-entry-active', editing);
  }
  const railBtn = document.getElementById('rt-doc-inline-edit');
  if (railBtn) {
    railBtn.title = editing ? '保存并退出编辑' : '编辑当前文章';
    railBtn.setAttribute('aria-label', editing ? '保存并退出编辑' : '编辑当前文章');
    railBtn.classList.toggle('text-primary', editing);
  }
}

export default function DocInlineEditor(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  /** 编辑器视口高度（px；打开时按正文高计算，超长文退化为可用屏高） */
  const [viewH, setViewH] = useState(0);

  /** 进入编辑前记录的滚动位置 / 原文顶部文档坐标 / 阅读进度（供长文对齐） */
  const savedScrollY = useRef(0);
  const savedArtTop = useRef(0);
  const savedProgress = useRef(0);
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
      setOpen(false);
      syncEntryButtons(false);
      setError(null);
      setDirty(false);
      dirtyRef.current = false;
      setPhase('idle');
      // 回到进入编辑前的位置（短文本就未动；长文把视口/文档高度还原后兜底恢复）
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

  /** 保存并退出（入口按钮 / 完成胶囊调用） */
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

  /** 打开：拉源码 → 计算视口高 → 原位替换正文（隐藏 article） */
  const openEditor = useCallback(async () => {
    const id = readActiveNodeId();
    if (!id) return;
    if (open) return;

    const art = document.querySelector<HTMLElement>('main article.prose');
    const artTop = art ? art.getBoundingClientRect().top + window.scrollY : window.scrollY;
    savedScrollY.current = window.scrollY;
    savedArtTop.current = artTop;
    // 正文渲染高（隐藏前量取）
    const artH = art ? art.getBoundingClientRect().height : 0;
    // 一屏可用编辑高：标题/面包屑约占顶部 220px，底部留 24px
    const avail = Math.max(320, window.innerHeight - 244);
    const fit = artH > 0 && artH <= avail;
    savedProgress.current = fit
      ? 0
      : Math.min(1, Math.max(0, (savedScrollY.current - artTop + window.innerHeight / 2) / Math.max(artH, 1)));

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
      // 编辑视口高：短文贴合原正文高（页面不跳）；超长文取可用屏高（编辑器内滚动）
      setViewH(fit ? Math.max(320, Math.round(artH)) : avail);
      const grid = document.getElementById('doc-3col');
      if (grid) grid.setAttribute('data-editing', 'true');
      setOpen(true);
      syncEntryButtons(true);
      setPhase('idle');

      // 布局稳定后：短文无需动滚动（页面总高≈不变）；长文把视口滚到正文起点，
      // 并将编辑器内部滚动同步到原阅读进度（精确行映射做不到，按像素比例近似）。
      requestAnimationFrame(() => {
        if (!fit && savedArtTop.current > 0) {
          window.scrollTo({ top: savedArtTop.current - 140, behavior: 'auto' });
        }
        window.setTimeout(() => {
          // 进入即交还键盘（光标仍在文档首部，点击任意正文位置即可放置光标）
          editorRef.current?.focus();
          const ed = document.querySelector('.doc-ie-view .cm-editor');
          if (ed && savedProgress.current > 0) {
            const scroller = ed.querySelector('.cm-scroller') as HTMLElement | null;
            if (scroller) {
              const target = scroller.scrollHeight * savedProgress.current - scroller.clientHeight / 2;
              scroller.scrollTop = Math.max(0, target);
            }
          }
        }, 60);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取正文失败');
      // 错误也走「原位」语义：隐藏正文、编辑视口给可用高，错误行落在正文位置
      const art = document.querySelector<HTMLElement>('main article.prose');
      if (art) art.style.display = 'none';
      setViewH(360);
      setOpen(true);
      syncEntryButtons(true);
      setPhase('idle');
    }
  }, [open]);

  /** 挂载期向页面脚本暴露 open / saveAndClose */
  useEffect(() => {
    window.__docInlineEditor = { open: () => void openEditor(), saveAndClose: handleSaveAndClose };
    return () => {
      delete window.__docInlineEditor;
    };
  }, [openEditor, handleSaveAndClose]);

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

  const saving = phase === 'saving';
  const showSaveFail = Boolean(error) && phase === 'idle';
  /** 错误态也需可用编辑视口高度（空内容编辑器也能落焦） */
  const effectiveViewH = viewH || 360;

  return (
    <div ref={hostRef} className={open ? 'doc-ie-host' : 'hidden'}>
      {open && (
        <div className="doc-ie-inner relative">
          {/* 编辑器区：正文原位替换（无卡片/无边框/无工具条），高度按内容策略计算 */}
          <div className="doc-ie-view" style={{ height: effectiveViewH }}>
            {phase === 'loading' ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">正在读取正文…</p>
            ) : (
              <MarkdownEditor
                ref={editorRef}
                initialContent={content}
                onChange={handleContentChange}
                onSave={() => handleSaveAndClose()}
                wysiwyg
                variant="ghost"
                className="h-full"
              />
            )}
          </div>

          {/* 读取/保存失败提示（非胶囊，独立红字行，不遮挡正文） */}
          {error && (
            <p className="mt-2 px-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          {/* 右下角状态胶囊：完成 = 保存退出；状态就近显示（不占文档流） */}
          {phase !== 'loading' && (
            <div className="doc-ie-status absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-full border border-border bg-background/85 py-1 pr-1 pl-3 text-[0.7rem] shadow-sm backdrop-blur">
              {showSaveFail ? (
                <span className="text-destructive">保存失败</span>
              ) : saving ? (
                <span className="text-muted-foreground">保存中…</span>
              ) : dirty ? (
                <span className="text-muted-foreground">● 未保存（自动保存中）</span>
              ) : lastSavedAt ? (
                <span className="text-muted-foreground">✓ 已自动保存 {lastSavedAt}</span>
              ) : (
                <span className="text-muted-foreground">就地编辑</span>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                title="放弃未保存修改并退出"
                aria-label="放弃修改并退出"
                className="rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                ×
              </button>
              <button
                type="button"
                data-testid="doc-editor-save"
                onClick={handleSaveAndClose}
                disabled={saving}
                className="rounded-full bg-primary px-2.5 py-0.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? '保存中…' : '完成'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
