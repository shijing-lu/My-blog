/**
 * doc-viewport.ts —— 文档页「视口定位 / 正文预取」的客户端共享工具
 *
 * 被三处共用（**同一份实现**，避免各写一份导致语义分叉）：
 * - `src/pages/doc/[id].astro` 的页内脚本（目录跳转、页内切换文章）
 * - `src/components/RightToolbar.astro` 的右侧悬浮编辑入口
 * - `src/components/doc/DocInlineEditor.tsx` 就地编辑岛
 *
 * 纯客户端、零依赖：**不得** import db / drizzle / node 内置模块
 * （否则会被打进客户端包）。
 */

/**
 * 瞬时滚动。
 *
 * ⚠️ **必须用 `behavior: 'instant'`，不能写 `'auto'`**：`global.css` 有
 * `html { scroll-behavior: smooth }`，而 CSSOM 规定 `'auto'` 的语义是
 * 「采用该元素 `scroll-behavior` 的计算值」——于是所谓「瞬时滚动」实际是平滑动画。
 * 实测（chromium）：`'auto'` 逐帧推进 `0→1→3→7→14→830→969…`；`'instant'` 单帧到位。
 *
 * 凡「先滚一次估位、数据到了再滚一次校正」的写法，在 smooth 下等于**两段动画互相
 * 打断**，终态取决于谁最后被调用 —— 这是「定位不准」的独立来源，不只是动画观感问题。
 */
export function instantScrollTo(top: number): void {
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

/**
 * 正文读取中的即时反馈：正文降透明 + 顶部不确定进度条。
 * 复用「页内切换文章」的同一套视觉语言（`.doc-article-loading` + `#doc-switch-progress`）。
 *
 * 为什么必须有：点「编辑」后要先等正文 fetch、再等 React 岛水合（`client:idle`），
 * 这段时间若毫无变化，用户会当成卡死并连点。
 */
export function setDocArticleLoading(on: boolean): void {
  document.querySelector('main article.prose')?.classList.toggle('doc-article-loading', on);
  document.getElementById('doc-switch-progress')?.classList.toggle('hidden', !on);
}

/* ================= 正文预取 =================
   悬停/聚焦「编辑」按钮时预热正文，点击后基本零等待（省掉一次 RTT + JSON 解析）。
   缓存按 node id 存；`takePrefetchedDocNode` **取用即删** —— 避免拿到「别处已改」
   的过期正文（正文可能在其它标签页/设备被改过），缓存只当加速、不当数据源。 */

const prefetchCache = new Map<string, string>();
const prefetchInflight = new Map<string, Promise<void>>();

/** 预取正文（幂等：已在缓存或飞行中则直接返回） */
export function prefetchDocNode(id: string): void {
  if (!id || prefetchCache.has(id) || prefetchInflight.has(id)) return;
  const p = fetch(`/api/doc/nodes/${id}`, { signal: AbortSignal.timeout(15000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { node?: { content?: string } } | null) => {
      if (typeof d?.node?.content === 'string') prefetchCache.set(id, d.node.content);
    })
    .catch(() => {
      /* 预取失败静默：正式打开时会再拉一次，不能因预取失败影响主流程 */
    })
    .finally(() => {
      prefetchInflight.delete(id);
    });
  prefetchInflight.set(id, p);
}

/** 取用预取结果并移除（未预取到返回 undefined，调用方自行 fetch） */
export function takePrefetchedDocNode(id: string): string | undefined {
  const hit = prefetchCache.get(id);
  if (hit !== undefined) prefetchCache.delete(id);
  return hit;
}

/** 已绑定过预取监听的按钮（幂等标记：不写 data-* 污染 DOM，避免破坏逐字节断言） */
const warmedButtons = new WeakSet<HTMLElement>();

/**
 * 给编辑入口按钮绑定「悬停/聚焦即预取」。
 *
 * 放在**页面脚本**里调用（而不是岛内部）：岛是 `client:idle`，水合可能晚于首次悬停，
 * 那样预取就白做了；页面脚本在 DOM 就绪即运行，不依赖水合。
 * ClientRouter 转场后 DOM 会被替换，调用方需在 `astro:page-load` 再调一次。
 */
export function warmDocEditEntry(buttonIds: readonly string[], readId: () => string): void {
  const warm = (): void => prefetchDocNode(readId());
  for (const id of buttonIds) {
    const el = document.getElementById(id);
    if (!el || warmedButtons.has(el)) continue;
    warmedButtons.add(el);
    el.addEventListener('pointerenter', warm);
    el.addEventListener('focus', warm);
  }
}
