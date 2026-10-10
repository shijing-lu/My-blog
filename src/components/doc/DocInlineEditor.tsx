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
 * - 几何前提：本岛是 `<article class="prose">` 的**紧邻兄弟**，`.doc-ie-host` 的
 *   `margin-top` 与 `<article>` 的 `mt-6` 对齐 → 隐藏正文后编辑器恰好落在正文原位置。
 * - 视口同步（阅读 ⇄ 编辑，Obsidian 式「不跳动」）：
 *   · 页面滚动只做**一次瞬时**动作：把编辑器盒顶对齐视口顶（`instantScrollTo`）。
 *     这样「编辑器视口顶」== 「页面视口顶」，锚点偏移可 1:1 复现，无需换算。
 *   · 位置用「**标题锚点 + 段内偏移**」表达，不用像素比例 —— 见 src/lib/view-anchor.ts。
 *     阅读态量「距视口顶最近的 h2–h4 及其偏移」，进编辑器后
 *     `scrollHeadingToOffset()` 把同一标题放到同一屏内偏移（内部 coordsAtPos 闭环收敛）。
 *   · 退出时先取编辑器侧锚点，恢复正文后按同一锚点瞬时回位；若本会话保存过，
 *     `/render` 到达时再次测量当下阅读位置，再替换 HTML，避免后台响应抢走用户的新位置。
 *   · ⚠️ 全站 `html { scroll-behavior: smooth }`，所以**必须** `behavior:'instant'`；
 *     写 `'auto'` 会走 CSS 计算值 → 平滑动画，多次滚动互相打断导致落点不可预测。
 * - 高度策略（CM 虚拟化不失效）：
 *   · 正文不高于「一屏可用高」→ 编辑视口高随内容（autoHeight，页面级滚动承载）；
 *   · 超长文 → 编辑视口 = 一屏可用高 + 编辑器内滚动。
 * - 响应速度：
 *   · 页面脚本在悬停/聚焦「编辑」按钮时预取正文（`__docPrefetchNode`），点击后基本零等待；
 *   · 点击瞬间即给反馈（正文降透明 + 顶部进度条，复用「页内切换文章」的视觉语言），
 *     不再「等 fetch 完才有反应」。
 * - 标题旁按钮与右侧悬浮框按钮：编辑中再点 = 保存并退出。
 *   自动保存继续运行，读取或保存失败以正文下方提示显示。
 * - 自动保存只 PATCH（编辑态正文隐藏，渲染结果暂时用不到）；关闭编辑器时若本
 *   会话保存过 → 后台补拉 /render 就地替换正文与目录（不 reload）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from '@/components/admin/MarkdownEditor';
import { enhanceBodyHeadings, revealBodyHeading } from '@/lib/body-heading-folding';
import type { MarkdownEditorHandle } from '@/components/admin/MarkdownEditor';
import { renderTocTreeHtml } from '@/lib/toc-tree';
import { activateInlineArticleTitle, type InlineArticleTitleSession } from '@/lib/inline-article-title';
import { createLatestSaveQueue } from '@/lib/latest-save-queue';
import { registerAiEditor } from '@/lib/ai-editor-bridge';
import { registerArticleBaseline, setArticleContentVersion } from '@/lib/pending-article-saves';
import { discardArticleField, flushPendingArticleSaves, pendingArticleField, rememberArticleSave, saveArticleSnapshot } from '@/lib/pending-article-saves';
import type { TocItem } from '@/lib/mdx-plugins';
import { indexOfNthHeading, pickNearestViewAnchor } from '@/lib/view-anchor';
import type { ViewAnchor } from '@/lib/view-anchor';
import { instantScrollTo, prefetchDocNode, takePrefetchedDocNode } from '@/lib/doc-viewport';

/** 自动保存防抖（ms）：停顿 1.5s 即静默 PATCH */
const AUTOSAVE_DEBOUNCE = 1500;

/** 编辑期间目录实时刷新防抖（ms）：比自动保存更跟手 */
const TOC_REFRESH_DEBOUNCE = 600;

/** 参与视口锚点的标题选择器（与 src/lib/view-anchor.ts 的 ANCHOR_LEVELS 对应） */
const HEADING_SELECTOR = 'h2, h3, h4';

/** 编辑器盒底距视口底留白（px）：盒顶贴视口顶后，用它算出编辑视口高 */
const EDITOR_BOTTOM_GAP = 32;

declare global {
  interface Window {
    /** 供 .astro 页面脚本调用（ClientRouter SPA 下会重新挂载，故用 window 桥接） */
    __docInlineEditor?: {
      open: () => void;
      saveAndClose?: () => void;
      openSearch?: () => boolean;
      /** 编辑态目录点击跳转：跳到第 nth 个（0 起）level 级标题；返回是否命中 */
      jumpToHeading?: (level: number, nth: number) => boolean;
    };
    /** 文档页提供的正文比例定位工具。 */
    __docScrollToProgress?: (ratio: number) => void;
  }
}

/** 读取当前激活文章 id（左栏切换文章后会变，故每次 open 时现读） */
function readActiveNodeId(): string {
  return document.getElementById('doc-detail-data')?.getAttribute('data-active-node') ?? '';
}

/** 页面骨架相同，正文读写由当前数据域决定。 */
function isHomeArticle(): boolean {
  return document.querySelector('[data-article-domain="home"]') !== null;
}

function articleApiUrl(id: string, render = false): string {
  return isHomeArticle()
    ? `/api/articles/${encodeURIComponent(id)}${render ? '/render' : ''}`
    : `/api/doc/nodes/${encodeURIComponent(id)}${render ? '/render' : ''}`;
}

/** 编辑器内部滚动容器（仅长文形态有内部滚动） */
function editorScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.doc-ie-view .cm-scroller');
}

/**
 * 编辑器滚动容器顶在**页面视口**里的 y 坐标（0 = 编辑器盒顶正好贴视口顶）。
 *
 * 两个方向的锚点各有一套坐标系，差的就是这一项：
 *  · 阅读侧（captureReadingAnchor / restoreReadingAnchor）用「相对**页面视口顶**」的偏移；
 *  · 编辑器侧（getViewportAnchor / scrollHeadingToOffset）用「相对**滚动容器顶**」的偏移。
 * 盒顶贴视口顶时两者重合（这就是「先滚页面、再让锚点 1:1 复现」的原因）；一旦页面滚不到
 * savedArtTop 被浏览器夹住（文档不够高），两者就差这一项 —— 不换算会单向偏移，且只在
 * 短文档/边界高度下暴露，极难复现。每次现读而不是缓存：用户滚动页面后它就变了。
 */
function editorScrollerTop(): number {
  return editorScroller()?.getBoundingClientRect().top ?? 0;
}

/** 编辑器内部滚动比例（0~1；锚点不可用时的回落定位依据） */
function readScrollerRatio(): number {
  const sc = editorScroller();
  const sh = sc?.scrollHeight ?? 0;
  if (!sc || sh <= 0) return 0;
  return Math.min(1, Math.max(0, sc.scrollTop / sh));
}

/** 阅读态标题序列（文档顺序；级别 + 顶边距视口顶的偏移） */
function readingHeadingTops(art: HTMLElement): { level: number; top: number; hidden: boolean }[] {
  return [...art.querySelectorAll<HTMLElement>(HEADING_SELECTOR)].map((h) => ({
    level: Number(h.tagName.slice(1)),
    top: h.getBoundingClientRect().top,
    hidden: !!h.closest('[data-body-heading-content][hidden]'),
  }));
}

/**
 * 阅读态视口锚点：距视口顶最近的 h2–h4 + 它距视口顶的偏移。
 *
 * 量取前临时关闭 content-visibility：视口外区块的高度是 contain-intrinsic-size
 * 的估算值（120px），不强制整篇布局就会量到假高度（首次定位偏移的老根因）。
 * 定位用「序列对齐」（同 level 第 nth 个）而非 slug/id，与目录跳转同一套语义 ——
 * 对重名标题、数学标题、中文 slug 差异全部免疫。
 */
function captureReadingAnchor(art: HTMLElement | null): ViewAnchor | null {
  if (!art) return null;
  art.classList.add('toc-nav-rendering');
  void art.offsetHeight;
  try {
    return pickNearestViewAnchor(readingHeadingTops(art));
  } finally {
    requestAnimationFrame(() => art.classList.remove('toc-nav-rendering'));
  }
}

/**
 * 把阅读视口对齐到「标题锚点 + 段内偏移」。
 * 返回是否命中；未命中（标题已被删/改序号）时调用方回落比例定位。
 * 正文换过 innerHTML 后，用替换前现取的锚点对齐。
 */
function restoreReadingAnchor(art: HTMLElement | null, anchor: ViewAnchor | null): boolean {
  if (!art || !anchor) return false;
  const heads = [...art.querySelectorAll<HTMLElement>(HEADING_SELECTOR)];
  const idx = indexOfNthHeading(
    heads.map((h) => ({ level: Number(h.tagName.slice(1)) })),
    anchor.level,
    anchor.nth,
  );
  if (idx < 0) return false;
  const target = heads[idx]!;
  revealBodyHeading(target);
  art.classList.add('toc-nav-rendering');
  void art.offsetHeight;
  instantScrollTo(target.getBoundingClientRect().top + window.scrollY - anchor.offset);
  requestAnimationFrame(() => art.classList.remove('toc-nav-rendering'));
  return true;
}

/**
 * 稳定期重复对齐：换完正文 innerHTML 后，图片/代码块/公式会异步回流，
 * 只对齐一次不够 —— 落点会在几百毫秒内继续漂移（实测 112–190px，约 1/5 屏）。
 *
 * 因此按锚点在若干时间点各再对齐一次（幂等）。用户一旦有**真实滚动输入**
 * （滚轮 / 触摸 / 按键）就立刻停手 —— 绝不和用户抢视口。这里不比对 scrollY：
 * 布局变化导致浏览器把 scrollY 夹走**正是要修的那种漂移**，比对会把该修的情况当成
 * 「用户滚过了」而放过。
 */
function realignWhileStable(art: HTMLElement | null, anchor: ViewAnchor | null, delays: readonly number[] = [300, 900]): void {
  if (!art || !anchor) return;
  const INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  let cancelled = false;
  const onInput = (): void => {
    cancelled = true;
  };
  const stop = (): void => {
    for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput);
  };
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true });
  const timers = delays.map((ms, i) =>
    window.setTimeout(() => {
      if (!art.isConnected || art.style.display === 'none' || document.getElementById('doc-3col')?.dataset.editing === 'true') {
        stop();
        for (const t of timers) window.clearTimeout(t);
        return;
      }
      if (cancelled) {
        stop();
        for (const t of timers) window.clearTimeout(t);
        return;
      }
      restoreReadingAnchor(art, anchor);
      if (i === delays.length - 1) stop();
    }, ms),
  );
}

/** 已绑定「用户手动滚动」监听的滚动容器（WeakSet：不往 DOM 写标记，见项目约定） */
const guardedScrollers = new WeakSet<HTMLElement>();

/** 会让编辑器滚动位置变化的按键（其余按键可能是输入，不该被当成「用户滚过」） */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

/**
 * 记录「用户自己滚过编辑器」：一旦置位，所有程序化对齐立刻停手 —— 绝不和用户抢视口。
 *
 * 只认**真实滚动输入**，不比对 scrollTop：我们自己的跨帧精校正、以及 CM 因高度修正
 * 自动微调的 scrollTop 都会改变数值，比对会把我们自己的动作误判成用户动作而提前放弃
 * （旧实现就是这个毛病，表现为「错峰收敛两次其实一次都没生效」）。
 */
function bindUserScrollGuard(sc: HTMLElement, mark: () => void): void {
  if (guardedScrollers.has(sc)) return;
  guardedScrollers.add(sc);
  sc.addEventListener('wheel', mark, { passive: true });
  sc.addEventListener('touchstart', mark, { passive: true });
  sc.addEventListener('touchmove', mark, { passive: true });
  sc.addEventListener('keydown', (e) => {
    if (SCROLL_KEYS.has((e as KeyboardEvent).key)) mark();
  });
  // 拖滚动条：pointerdown 直接落在滚动容器自身（点在正文内容上不算）
  sc.addEventListener('pointerdown', (e) => {
    if (e.target === sc) mark();
  });
}

/** 目录快照项（编辑态目录点击跳转的定位依据） */
interface TocSnapshotItem {
  level: number;
  text: string;
}

/**
 * 从右侧目录面板采集目录快照（level + 规范化文本，DOM 顺序 = 文档顺序）。
 * 复用现成 TOC DOM，免新增请求；克隆后移除 .katex-mathml（MathML 可达性副本）
 * 再取 textContent，避免 KaTeX 富文本把公式源码重复计入。
 */
function collectTocSnapshot(): TocSnapshotItem[] {
  const list = document.getElementById('doc-toc-list');
  if (!list) return [];
  const out: TocSnapshotItem[] = [];
  list.querySelectorAll<HTMLElement>('a.toc-item').forEach((a) => {
    const m = /toc-l(\d)/.exec(a.className);
    if (!m) return;
    const clone = a.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.katex-mathml').forEach((el) => el.remove());
    out.push({ level: Number(m[1]), text: (clone.textContent ?? '').replace(/\s+/g, ' ').trim() });
  });
  return out;
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

function showSaveFeedback(text: string, state: string): void {
  const status = document.getElementById('article-save-status');
  if (!status) return;
  status.hidden = false;
  status.textContent = text;
  status.dataset.state = state;
}

export default function DocInlineEditor(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const titleSessionRef = useRef<InlineArticleTitleSession | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const aiApplyingRef = useRef(false);
  const aiLockedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [visualModule, setVisualModule] = useState<typeof import('../admin/cm-wysiwyg') | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** 编辑器视口高度（px；打开时按正文高计算，超长文退化为可用屏高） */
  const [viewH, setViewH] = useState(0);

  /** 视图实际交换前记录的滚动位置 / 原文顶部文档坐标 / 原文渲染高 */
  const savedScrollY = useRef(0);
  const savedArtTop = useRef(0);
  const savedArtH = useRef(0);
  /** 可见 DOM 交换前的阅读锚点（标题 + 段内偏移）；无标题时回落比例定位 */
  const savedAnchor = useRef<ViewAnchor | null>(null);
  /** 回落用的阅读进度（视口顶在正文中的比例 0~1；锚点不可用时才用） */
  const savedProgress = useRef(0);
  /** 短文形态（编辑器高度随内容，由页面滚动承载） */
  const fitRef = useRef(true);
  /** 打开流程互斥：加载中重复点击不再发第二次 fetch（也避免按钮语义来回翻） */
  const busyRef = useRef(false);
  const openingRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const cancelOpening = useCallback((): void => {
    if (!openingRef.current) return;
    openingRef.current.controller.abort();
    openingRef.current = null;
    busyRef.current = false;
    setPhase('idle');
    document.querySelector('main article.prose')?.classList.remove('doc-article-loading');
    document.getElementById('doc-switch-progress')?.classList.add('hidden');
  }, []);
  useEffect(() => {
    const identity = document.getElementById('doc-detail-data');
    const observer = new MutationObserver(() => {
      if (openingRef.current && readActiveNodeId() !== openingRef.current.id) cancelOpening();
    });
    if (identity) observer.observe(identity, { attributes: true, attributeFilter: ['data-active-node'] });
    document.addEventListener('astro:before-preparation', cancelOpening);
    return () => { observer.disconnect(); document.removeEventListener('astro:before-preparation', cancelOpening); cancelOpening(); };
  }, [cancelOpening]);
  /** 用户是否自己滚过编辑器（一旦为真，程序化对齐全部停手）；每次进入编辑重置 */
  const userScrolledEditorRef = useRef(false);
  const markUserScroll = useCallback((): void => {
    userScrolledEditorRef.current = true;
  }, []);
  /** 当前编辑的文章 id（ref：closeEditor 异步路径里取最新值） */
  const nodeIdRef = useRef('');
  /** 目录快照（openEditor 成功后采集，供编辑态目录点击跳转做序列对齐与文本校验） */
  const tocSnapshotRef = useRef<TocSnapshotItem[]>([]);
  /** 当前高亮的目录项（反向联动：编辑器滚动 → 目录 toc-active） */
  const activeTocElRef = useRef<HTMLElement | null>(null);
  /** 最新正文（saveCore 直接读 ref，避免闭包陈旧内容覆盖新输入） */
  const contentRef = useRef('');
  const saveSessionRef = useRef<{ id: string; url: string; content: string } | null>(null);
  /** 未保存标记（state 供 UI，ref 供异步保存逻辑） */
  const dirtyRef = useRef(false);
  /** 本会话是否成功保存过（决定关闭时是否需要补拉 render） */
  const savedRef = useRef(false);
  /** 自动保存定时器 + 保存互斥锁（防并发 PATCH 把 updatedAt 写旧） */
  const saveTimer = useRef(0);
  const saveQueueRef = useRef<ReturnType<typeof createLatestSaveQueue<string>> | null>(null);
  /** 目录实时刷新定时器（编辑期间标题增删 → 重建目录树） */
  const tocTimer = useRef(0);
  const alignmentFrame = useRef(0);
  const clearAlignment = useCallback((): void => {
    cancelAnimationFrame(alignmentFrame.current);
    alignmentFrame.current = 0;
  }, []);

  /**
   * 后台补拉 /render 并就地替换正文与目录（关闭编辑器后调用，不阻塞 UI）。
   *
   * 请求期间用户仍可滚动，因此在替换 DOM 的瞬间重新捕获当下阅读位置。
   */
  const refreshRendered = useCallback(
    (id: string) => {
      void (async () => {
        try {
          // 不带 v → 绕过 CDN 缓存，强制回源重渲
          const rr = await fetch(articleApiUrl(id, true));
          const d = (await rr.json().catch(() => ({}))) as { html?: string; toc?: TocItem[]; error?: string };
          // 已跳转到另一篇或重新打开编辑器时，丢弃旧请求，避免覆盖新正文/目录。
          if (!rr.ok || typeof d.html !== 'string' || readActiveNodeId() !== id || !hostRef.current?.isConnected || !hostRef.current.classList.contains('hidden')) return;
          const art = document.querySelector<HTMLElement>('main article.prose');
          const scrollY = window.scrollY;
          const anchor = captureReadingAnchor(art);
          if (art) { art.innerHTML = d.html; enhanceBodyHeadings(art); }
          // 正文重写后重建黑幕开关（spoiler.ts 监听；幂等，无 :spoiler 语法时不注入）
          document.dispatchEvent(new CustomEvent('spoiler:refresh'));
          const tocWrap = document.getElementById('doc-toc-list');
          if (tocWrap && Array.isArray(d.toc)) {
            tocWrap.innerHTML = d.toc.length ? renderTocTreeHtml(d.toc) : '<p class="text-xs text-muted-foreground">无目录</p>';
          }
          // 以替换前的当前位置为准，不能用退出编辑时可能已经过期的锚点。
          if (restoreReadingAnchor(art, anchor)) {
            // 换完 innerHTML 后图片/公式继续回流 → 稳定期再对齐两次（用户滚过就停手）
            realignWhileStable(art, anchor);
            return;
          }
          instantScrollTo(scrollY);
        } catch {
          /* 刷新失败：保留旧正文，下次进入或刷新页面自然更新 */
        }
      })();
    },
    [],
  );

  /** 统一保存：合并并发请求，并持续保存请求期间产生的新内容。 */
  const saveCore = useCallback(async (): Promise<boolean> => {
    if (aiLockedRef.current) return false;
    const session = saveSessionRef.current;
    if (!session) return false;
    const { id, url: saveUrl } = session;
    if (!dirtyRef.current) return true;
    setPhase('saving');
    try {
      saveQueueRef.current ??= createLatestSaveQueue(
        () => session.content,
        async (snapshot) => {
          const saved = await saveArticleSnapshot(saveUrl, { content: snapshot }) as { node?: { updatedAt?: string } };
          syncNodeUpdatedAt(id, saved.node?.updatedAt);
          if (saveSessionRef.current === session) savedRef.current = true;
        },
      );
      const savedContent = await saveQueueRef.current.flush();
      if (saveSessionRef.current !== session) return true;
      dirtyRef.current = contentRef.current !== savedContent;
      setError(null);
      return true;
    } catch (err) {
      if (saveSessionRef.current === session) setError(err instanceof Error ? err.message : '保存失败');
      return false; // dirty 保留：用户继续输入会再次触发自动保存
    } finally {
      if (saveSessionRef.current === session) setPhase('idle');
    }
  }, []);

  /** ref 桥：闭包内始终调用最新 saveCore（避免声明顺序与陈旧闭包问题） */
  const saveCoreRef = useRef(saveCore);
  saveCoreRef.current = saveCore;

  /** 关闭编辑态：恢复正文、清理编辑态副作用（有未保存改动时先保存） */
  const closeEditor = useCallback(
    async (opts?: { discard?: boolean }) => {
      if (aiLockedRef.current) return;
      cancelOpening();
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(tocTimer.current);
      while (dirtyRef.current && !opts?.discard) {
        const ok = await saveCoreRef.current();
        if (!ok) return; // 保存失败：保持编辑态，error 已提示
      }
      if (!opts?.discard && titleSessionRef.current && !(await titleSessionRef.current.flush())) return;
      titleSessionRef.current?.close(Boolean(opts?.discard));
      titleSessionRef.current = null;
      if (opts?.discard && saveSessionRef.current) discardArticleField(saveSessionRef.current.url, 'content');
      clearAlignment();
      const exitScrollY = window.scrollY;
      const grid = document.getElementById('doc-3col');
      // ① 趁编辑器还在，先量出退出锚点（之后编辑器就卸了）
      //    编辑器侧偏移是「相对滚动容器顶」的；阅读侧（restoreReadingAnchor / refreshRendered
      //    的二次对齐）用「相对页面视口顶」的偏移 → 必须换算，否则单向偏移一个 st。
      //    同一帧内两次只读测量，中间没有写，布局不会变，所以两次量的是同一份几何。
      const rawExit = fitRef.current ? null : (editorRef.current?.getViewportAnchor() ?? null);
      const exitAnchor: ViewAnchor | null = rawExit
        ? { level: rawExit.level, nth: rawExit.nth, offset: rawExit.offset + editorScrollerTop() }
        : null;
      const fallbackProgress = fitRef.current ? 0 : readScrollerRatio();
      // ② 立刻隐藏编辑器并恢复正文 —— 必须在测量之前，
      //    否则量到的是「正文 + 编辑器」并存时的布局高度
      hostRef.current?.classList.add('hidden');
      const art = document.querySelector<HTMLElement>('main article.prose');
      if (art?.parentElement) art.parentElement.style.minHeight = '';
      if (art) art.style.display = '';
      if (grid) grid.setAttribute('data-editing', 'false');
      setOpen(false);
      syncEntryButtons(false);
      setError(null);
      dirtyRef.current = false;
      setPhase('idle');
      // ③ 模式切换视口同步（编辑 → 阅读，Obsidian 式不跳动）——
      //    短文形态：页面级滚动承载；使用保存结束后的当前页面位置。
      //    长文形态：按「标题锚点 + 段内偏移」回到同一小节的同一深度（瞬时、无动画），
      //    而不是跳回进入编辑前的旧位置，也不用像素比例（渲染/源码密度差异必偏）。
      if (fitRef.current) {
        // 编辑期间用户可能继续滚动；退出时只能使用保存完成后的当前位置。
        instantScrollTo(exitScrollY);
      } else if (!restoreReadingAnchor(art, exitAnchor)) {
        // 锚点不可用（标题被删 / 视口落在第一标题之前）→ 回落按编辑器滚动比例映射
        instantScrollTo(savedArtTop.current + fallbackProgress * savedArtH.current);
      }
      // 清除目录反向高亮
      activeTocElRef.current?.classList.remove('toc-active');
      activeTocElRef.current = null;
      // ④ 本会话保存过 → 后台补拉最新渲染。请求期间仍可滚动，刷新前会重新取锚点。
      const id = nodeIdRef.current;
      if (savedRef.current && id) {
        refreshRendered(id);
      } else if (exitAnchor) {
        // 本会话没保存 → 不会换正文，但正文刚从 display:none 恢复、布局仍在稳定中
        realignWhileStable(art, exitAnchor);
      }
    },
    [refreshRendered, clearAlignment, cancelOpening],
  );

  /**
   * 编辑期间目录实时刷新：源码扫描（M1 同款语法树）→ 纯文本 TocItem 重建目录树。
   * 保留用户折叠状态（level+text 键）；重建后同步快照并重新触发反向高亮。
   * 目录项退化为纯文本（无 KaTeX 富文本），编辑态可接受；退出编辑补拉渲染即恢复。
   */
  const refreshToc = useCallback((): void => {
    const list = document.getElementById('doc-toc-list');
    if (!list) return;
    activeTocElRef.current?.classList.remove('toc-active');
    activeTocElRef.current = null;
    const heads = editorRef.current?.getHeadings() ?? [];
    if (heads.length === 0) {
      list.innerHTML = '<p class="text-xs text-muted-foreground">无目录</p>';
      return;
    }
    // 记录折叠节点（level+text 键，重建后恢复）
    const folded = new Set<string>();
    list.querySelectorAll<HTMLElement>('.toc-node.folded').forEach((n) => {
      const item = n.querySelector<HTMLElement>('.toc-item');
      const lv = item ? /toc-l(\d)/.exec(item.className)?.[1] : undefined;
      if (item && lv) folded.add(`${lv}:${(item.textContent ?? '').trim()}`);
    });
    const items = heads.map((h, i) => ({ id: `edit-toc-${i}`, text: h.text, level: h.level as 2 | 3 | 4 }));
    list.innerHTML = renderTocTreeHtml(items);
    // 恢复折叠状态
    list.querySelectorAll<HTMLElement>('.toc-node').forEach((n) => {
      const item = n.querySelector<HTMLElement>(':scope > .toc-row > .toc-item');
      const lv = item ? /toc-l(\d)/.exec(item.className)?.[1] : undefined;
      if (item && lv && folded.has(`${lv}:${(item.textContent ?? '').trim()}`)) {
        n.classList.add('folded');
        const btn = n.querySelector('.toc-fold');
        btn?.setAttribute('aria-expanded', 'false');
        btn?.setAttribute('aria-label', '展开子目录');
      }
    });
    // 快照与反向高亮同步到新目录
    tocSnapshotRef.current = collectTocSnapshot();
    editorRef.current?.emitViewportHeading();
  }, []);

  /** 编辑内容变化：标脏 + 重置自动保存定时器（防抖） */
  const handleContentChange = useCallback(
    (v: string) => {
      // CodeMirror 持有实时正文；父岛只同步脏标记，避免每次按键重渲染整棵工具栏。
      contentRef.current = v;
      if (saveSessionRef.current) {
        saveSessionRef.current.content = v;
        if (!aiApplyingRef.current) rememberArticleSave(saveSessionRef.current.url, { content: v });
      }
      if (aiApplyingRef.current) {
        dirtyRef.current = false; savedRef.current = true; refreshToc(); return;
      }
      dirtyRef.current = true;
      showSaveFeedback('待自动保存', 'pending');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void saveCoreRef.current();
      }, AUTOSAVE_DEBOUNCE);
      // 目录实时刷新（独立防抖，更跟手）
      window.clearTimeout(tocTimer.current);
      tocTimer.current = window.setTimeout(refreshToc, TOC_REFRESH_DEBOUNCE);
    },
    [refreshToc],
  );

  /**
   * 反向高亮联动（编辑器滚动 → 目录当前小节）：
   * 定位目录中「同 level 第 nth 项」（与 M1 跳转同一套序列对齐语义），
   * 切换 toc-active、展开折叠祖先、面板内滚动跟随。
   */
  const handleViewportHeading = useCallback(
    (h: { level: number; text: string; nth: number } | null): void => {
      const prev = activeTocElRef.current;
      const list = document.getElementById('doc-toc-list');
      const el = h ? list?.querySelectorAll<HTMLElement>(`a.toc-l${h.level}`)[h.nth] ?? null : null;
      if (prev === el) return;
      prev?.classList.remove('toc-active');
      activeTocElRef.current = null;
      if (!el) return;
      el.classList.add('toc-active');
      activeTocElRef.current = el;

      // 展开折叠的祖先节点（自身节点的 folded 只影响子级，不动）
      let parent = el.parentElement?.closest<HTMLElement>('.toc-node');
      while (parent) {
        if (parent.classList.contains('folded')) {
          parent.classList.remove('folded');
          const foldBtn = parent.querySelector('.toc-fold');
          foldBtn?.setAttribute('aria-expanded', 'true');
          foldBtn?.setAttribute('aria-label', '折叠子目录');
        }
        parent = parent.parentElement?.closest<HTMLElement>('.toc-node') ?? null;
      }

      // 面板内滚动跟随：仅在 active 项越出可视区时滚动（#doc-toc-rail 是滚动容器）
      const rail = document.getElementById('doc-toc-rail');
      if (rail) {
        const r = el.getBoundingClientRect();
        const rr = rail.getBoundingClientRect();
        if (r.top < rr.top + 8) rail.scrollTop += r.top - rr.top - 8;
        else if (r.bottom > rr.bottom - 8) rail.scrollTop += r.bottom - rr.bottom + 8;
      }
    },
    [],
  );

  /** 保存并退出（入口按钮调用） */
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


  /**
   * 按已记录的阅读锚点对齐编辑器视口（进入编辑时 + 两次错峰收敛共用）。
   *
   * 锚点缺失（视口落在第一标题之前）或标题已不存在时，回落「按滚动比例」定位。
   * 用户一旦自己滚过编辑器就整个放弃 —— 绝不和用户抢视口（见 bindUserScrollGuard）。
   */
  const applyAnchor = useCallback((): void => {
    if (userScrolledEditorRef.current) return; // 用户自己滚过 → 绝不抢视口
    const scroller = editorScroller();
    // 阅读侧偏移 → 编辑器侧偏移：减去「滚动容器顶在视口里的位置」（盒顶贴顶时即 0）。
    // 每次现读：错峰收敛期间用户可能滚过页面，缓存值会过期。
    const st = editorScrollerTop();
    const anchor = savedAnchor.current;
    if (anchor && editorRef.current?.scrollHeadingToOffset(anchor.level, anchor.nth, anchor.offset - st)) {
      return;
    }
    if (scroller) {
      // 比例回落同一换算：容器顶越低（st > 0），需要多滚 st 才让同一内容落到视口顶
      scroller.scrollTop = Math.max(0, scroller.scrollHeight * savedProgress.current + st);
    }
  }, []);

  /** 编辑器及即时预览都准备好后，才在一次绘制前交换阅读正文与编辑器。 */
  const revealEditor = useCallback((): void => {
    const id = nodeIdRef.current;
    cancelAnimationFrame(alignmentFrame.current);
    alignmentFrame.current = requestAnimationFrame(() => {
      alignmentFrame.current = 0;
      const host = hostRef.current;
      const art = document.querySelector<HTMLElement>('main article.prose');
      if (!host?.isConnected || !art || readActiveNodeId() !== id) return;
      // 请求正文、加载装饰期间阅读页仍可滚动。以真正切换前的视口为准，
      // 否则网络快慢会决定显示编辑器时跳回哪一个旧位置。
      savedScrollY.current = window.scrollY;
      savedArtTop.current = art.getBoundingClientRect().top + window.scrollY;
      savedArtH.current = art.getBoundingClientRect().height;
      savedAnchor.current = fitRef.current ? null : captureReadingAnchor(art);
      savedProgress.current = fitRef.current
        ? 0
        : Math.min(1, Math.max(0, (savedScrollY.current - savedArtTop.current) / Math.max(savedArtH.current, 1)));
      const holder = art.parentElement;
      if (holder) holder.style.minHeight = `${holder.getBoundingClientRect().height}px`;
      art.style.display = 'none';
      host.style.position = '';
      host.style.width = '';
      if (fitRef.current) {
        instantScrollTo(savedScrollY.current);
      } else {
        instantScrollTo(savedArtTop.current);
        const scroller = editorScroller();
        if (scroller) bindUserScrollGuard(scroller, markUserScroll);
        applyAnchor();
      }
      if (holder) holder.style.minHeight = '';
      // 正文退场时页面高度可能被浏览器夹位；在同一帧内完成最后一次校正。
      if (fitRef.current) instantScrollTo(savedScrollY.current);
      else {
        instantScrollTo(savedArtTop.current);
        applyAnchor();
      }
      host.style.visibility = '';
      editorRef.current?.refreshVisualLayout();
      // 隐藏窗口滚动条会增加布局宽度；把原滚动条宽度留在 body 右侧，避免换行抖动。
      document.documentElement.style.setProperty(
        '--doc-edit-scrollbar-gutter',
        `${Math.max(0, window.innerWidth - document.documentElement.clientWidth)}px`,
      );
      document.getElementById('doc-3col')?.setAttribute('data-editing', 'true');
      titleSessionRef.current?.close();
      titleSessionRef.current = activateInlineArticleTitle(id, setError);
      syncEntryButtons(true);
      setPhase('idle');
    });
  }, [applyAnchor, markUserScroll]);

  /** 打开：即时反馈 → 拉源码（预取命中则零等待）→ 计算视口高 → 原位替换正文 */
  const openEditor = useCallback(async () => {
    const id = readActiveNodeId();
    if (!id || open || busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    const opening = { id, controller };
    openingRef.current = opening;
    clearAlignment();
    setReadFailed(false);
    savedRef.current = false;

    const art = document.querySelector<HTMLElement>('main article.prose');
    /** 正文父容器：正文隐藏期间用它撑住文档高度（try / catch 两处都要撤，故提到外面） */
    const holder = art?.parentElement ?? null;
    // 正文渲染高（隐藏前量取；仅作锚点不可用时的比例回落依据）
    const artH = art ? art.getBoundingClientRect().height : 0;
    // 编辑视口高：盒顶贴视口顶，底部留 EDITOR_BOTTOM_GAP —— 让编辑器尽量占满一屏
    const avail = Math.max(320, window.innerHeight - EDITOR_BOTTOM_GAP);
    // 短文形态：正文不高于一屏可用高 → 编辑器高度随内容撑开（无内部滚动，
    // 页面级滚动承载——与阅读正文完全一致）；超长文 → 一屏高 + 编辑器内滚（保 CM 虚拟化）。
    const fit = artH <= avail;
    fitRef.current = fit;
    // 阅读位置在编辑器准备好、可见 DOM 交换之前测量，避免加载期间滚动导致旧快照。
    userScrolledEditorRef.current = false;

    // 阅读正文保持原样，直到编辑器及所见即所得装饰均完成挂载。
    setPhase('loading');
    setError(null);
    nodeIdRef.current = id;
    // 顺手触发一次预取（悬停已预取过则是幂等 no-op）
    if (!isHomeArticle()) prefetchDocNode(id);
    try {
      // 预取命中则零等待；用掉即删 —— 缓存只当加速，不当数据源（正文可能在别处已改）
      let text = isHomeArticle() ? undefined : takePrefetchedDocNode(id);
      if (text === undefined) {
        const res = await fetch(articleApiUrl(id), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const d = (await res.json().catch(() => ({}))) as { node?: { content?: string }; article?: { content?: string }; error?: string };
        const content = isHomeArticle() ? d.article?.content : d.node?.content;
        if (!res.ok || typeof content !== 'string') throw new Error(d.error ?? '读取正文失败');
        text = content;
      }
      const readyVisualModule = await import('../admin/cm-wysiwyg');
      await registerArticleBaseline(articleApiUrl(id), text);
      if (controller.signal.aborted || openingRef.current !== opening || !hostRef.current?.isConnected || readActiveNodeId() !== id) return;
      const pendingContent = pendingArticleField(articleApiUrl(id), 'content');
      if (pendingContent !== null) text = pendingContent;
      saveQueueRef.current = null;
      contentRef.current = text;
      saveSessionRef.current = { id, url: articleApiUrl(id), content: text };
      setContent(text);
      setVisualModule(readyVisualModule);
      dirtyRef.current = pendingContent !== null;
      savedRef.current = false;
      // 编辑视口高：短文 0 = 高度随内容（auto，无滚动条）；超长文取可用屏高（编辑器内滚动）
      setViewH(fit ? 0 : avail);
      // 在正文仍占据文档流时挂载隐藏的编辑器；它有真实宽度，可以完成 CodeMirror
      // 的几何测量，但不会让浏览器在两次绘制之间夹走页面滚动位置。
      if (hostRef.current) {
        hostRef.current.style.visibility = 'hidden';
        hostRef.current.style.position = 'absolute';
        hostRef.current.style.width = `${art?.getBoundingClientRect().width ?? 0}px`;
      }
      tocSnapshotRef.current = collectTocSnapshot();
      setPhase('idle');
      setOpen(true);
    } catch (err) {
      if (controller.signal.aborted || openingRef.current !== opening || !hostRef.current?.isConnected || readActiveNodeId() !== id) return;
      setReadFailed(true);
      setError(err instanceof Error && err.name === 'TimeoutError' ? '读取正文超时，请退出编辑后重试' : err instanceof Error ? err.message : '读取正文失败');
      // 读取失败只显示错误与退出入口，不挂载可保存的空编辑器，避免覆盖原文。
      if (holder) holder.style.minHeight = '';
      if (art) art.style.display = 'none';
      fitRef.current = true;
      setViewH(0);
      setOpen(true);
      syncEntryButtons(true);
      setPhase('idle');
    } finally {
      if (openingRef.current === opening) {
        openingRef.current = null;
        busyRef.current = false;
        document.querySelector('main article.prose')?.classList.remove('doc-article-loading');
        document.getElementById('doc-switch-progress')?.classList.add('hidden');
      }
    }
  }, [open, clearAlignment]);

  /** 挂载期向页面脚本暴露 open / saveAndClose / jumpToHeading */
  useEffect(() => {
    if (!open || readFailed || !saveSessionRef.current) return;
    const session = saveSessionRef.current;
    return registerAiEditor({
      session: crypto.randomUUID(), domain: isHomeArticle() ? 'article' : 'doc', targetId: session.id,
      ownsRoot: root => editorRef.current?.ownsRoot(root) ?? false,
      source: () => editorRef.current?.getSource() ?? contentRef.current,
      flush: async () => {
        if (saveSessionRef.current !== session || aiLockedRef.current) return false;
        editorRef.current?.flushInputs(); window.clearTimeout(saveTimer.current);
        if(!(await saveCoreRef.current()))return false;
        if(titleSessionRef.current && !(await titleSessionRef.current.flush()))return false;
        return true;
      },
      lock: locked => { aiLockedRef.current = locked; editorRef.current?.lockAiInput(locked); },
      apply: (source, contentHash) => {
        if (saveSessionRef.current !== session) throw new Error('文章编辑会话已切换');
        window.clearTimeout(saveTimer.current); aiApplyingRef.current = true;
        try { editorRef.current?.applyAiSource(source); contentRef.current = source; session.content = source; }
        finally { aiApplyingRef.current = false; }
        discardArticleField(session.url, 'content'); saveQueueRef.current = null;
        if(contentHash)setArticleContentVersion(session.url,contentHash);
        dirtyRef.current = false; savedRef.current = true; refreshToc();
      },
    });
  }, [open, readFailed, refreshToc]);

  useEffect(() => {
    window.__docInlineEditor = {
      open: () => void openEditor(),
      saveAndClose: handleSaveAndClose,
      openSearch: () => editorRef.current?.openSearch() ?? false,
      jumpToHeading: (level: number, nth: number): boolean => {
        // expectText 从快照同 level 第 nth 项取，供编辑器侧做文本一致性告警
        const expect = tocSnapshotRef.current.filter((t) => t.level === level)[nth]?.text;
        return editorRef.current?.jumpToHeading(level, nth, expect) ?? false;
      },
    };
    return () => {
      delete window.__docInlineEditor;
    };
  }, [openEditor, handleSaveAndClose]);

  /** 卸载清理：未决的自动保存/目录刷新定时器 */
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(tocTimer.current);
      if (dirtyRef.current) void saveCoreRef.current();
      void titleSessionRef.current?.flush();
      titleSessionRef.current?.close();
      titleSessionRef.current = null;
      clearAlignment();
    },
    [clearAlignment],
  );

  /** Periodic autosave and silent navigation flush; pending snapshots survive a failed request. */
  useEffect(() => {
    if (!open) return;
    const flush = (): void => {
      if (dirtyRef.current) void saveCoreRef.current();
      void titleSessionRef.current?.flush();
      void flushPendingArticleSaves(true);
    };
    const timer = window.setInterval(flush, 3000);
    window.addEventListener('pagehide', flush);
    document.addEventListener('astro:before-preparation', flush);
    return () => {
      flush();
      window.clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('astro:before-preparation', flush);
    };
  }, [open]);

  /** viewH = 0 → 高度随内容（短文形态，无内部滚动条）；> 0 → 固定视口高（长文内滚） */
  const autoHeight = viewH === 0;

  useEffect(() => {
    const status = document.getElementById('article-save-status');
    if (!open) { if (status) status.hidden = true; return; }
    showSaveFeedback(
      error ? '保存或读取失败' : phase === 'loading' ? '正在读取…' : phase === 'saving' ? '正在保存…' : dirtyRef.current ? '待自动保存' : '正文已保存',
      error ? 'error' : phase === 'saving' ? 'saving' : dirtyRef.current ? 'pending' : 'saved',
    );
  }, [open, phase, error]);

  return (
    <div ref={hostRef} className={open ? 'doc-ie-host' : 'hidden'}>
      {open && (
        <div className="doc-ie-inner relative">
          {/* 编辑器区：正文原位替换（无卡片/无边框/无工具条），高度按内容策略计算 */}
          <div className="doc-ie-view" style={{ height: autoHeight ? 'auto' : `${viewH}px` }}>
            {phase === 'loading' || !visualModule ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">正在读取正文…</p>
            ) : readFailed ? null : (
              <MarkdownEditor
                foldHeadings
                documentContextMenu
                ref={editorRef}
                initialContent={content}
                onChange={handleContentChange}
                onSave={() => handleSaveAndClose()}
                wysiwyg
                initialWysiwyg={visualModule ?? undefined}
                variant="ghost"
                autoHeight={autoHeight}
                className="h-full"
                onViewportHeading={handleViewportHeading}
                onReady={revealEditor}
                onLoadError={(cause) => {
                  setError(`可视编辑器加载失败：${cause.message}`); setReadFailed(true); setPhase('idle');
                  const host = hostRef.current;
                  if (host) { host.style.visibility = ''; host.style.position = ''; host.style.width = ''; }
                  document.querySelector<HTMLElement>('main article.prose')?.style.setProperty('display', '');
                  syncEntryButtons(true);
                }}
              />
            )}
          </div>

          {/* 读取/保存失败提示（独立红字行，不遮挡正文） */}
          {error && (
            <p className="mt-2 px-1 text-xs text-destructive" role="alert">
              {error}
              {!readFailed && <button type="button" className="ml-3 rounded-md border border-current px-3 py-2" disabled={phase === 'saving'} onClick={() => { void saveCoreRef.current(); }}>重新保存</button>}
            </p>
          )}


        </div>
      )}
    </div>
  );
}
