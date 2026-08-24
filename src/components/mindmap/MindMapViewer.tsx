/**
 * MindMapViewer.tsx —— 思维导图只读查看器（文章页抽屉）
 *
 * - readonly 渲染（同一 simple-mind-map 数据格式，与编辑器一致）；
 * - 点击带锚点（anchorId）或片段（snippet）的节点 → 平滑滚动文章对应段落并闪烁
 *   高亮（不收起抽屉）；
 * - 支持从文章拖拽选中片段到画布：
 *   - dragover 实时感应鼠标落在哪个节点 → 该节点边框高亮（跟着鼠标切换）；
 *   - drop 松手弹出命名弹框（不是粘贴全文）→ 确认后插入到目标节点下
 *     （POST refs 带 parentId；拖到空白处则追加到根节点）；
 * - 监听 mindmap-refresh：外部新增引用后重新拉取数据刷新画布。
 */
import { useEffect, useRef, useState } from 'react';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import type MindMap from 'simple-mind-map';
import type { MindMapData } from 'simple-mind-map';

interface BlockInfo {
  type: string;
  text: string;
}

interface Props {
  /** simple-mind-map 全量数据（对象） */
  data: unknown;
  /** 文章块级锚点映射（para-N → 块信息） */
  blockMap?: Record<string, BlockInfo>;
  /** 导图 id（保存引用 / 刷新用） */
  mapId?: string;
}

/** 拖拽落点数据 */
interface DropData {
  /** 目标节点 uid（null = 追加到根） */
  targetUid: string | null;
  /** 目标节点标题（弹框提示用） */
  targetTitle: string;
  /** 选中的原文片段 */
  snippet: string;
  /** 文章段落锚点（可能为空） */
  anchorId?: string;
}

/** simple-mind-map 节点实例子集（渲染层操作） */
interface NodeLike {
  /** SVG group 元素（getBoundingClientRect 直接给视口坐标，无需坐标换算） */
  group?: { node?: SVGElement };
  highlight?: () => void;
  closeHighlight?: () => void;
  getData?: () => { data?: { text?: string } };
}

/** 导航到文章锚点/片段（anchorId 优先，否则用 snippet 在块摘要中模糊匹配） */
function jumpToBlock(
  anchorId: string | undefined,
  snippet: string | undefined,
  blockMap: Record<string, BlockInfo>,
): boolean {
  const flash = (el: HTMLElement): void => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mind-anchor-flash');
    window.setTimeout(() => el.classList.remove('mind-anchor-flash'), 2200);
  };
  // 1) 锚点直接定位
  if (anchorId) {
    const el = document.getElementById(anchorId);
    if (el) {
      flash(el);
      return true;
    }
  }
  // 2) 锚点失效 / 无锚点（编辑页创建的 snippet 引用）：用片段文本模糊匹配块摘要
  const source = (anchorId ? blockMap[anchorId]?.text : undefined) ?? snippet ?? '';
  const key = source.replace(/[#*`>\[\]()]/g, '').trim().slice(0, 20);
  if (key) {
    const entries = Object.entries(blockMap);
    const hit =
      entries.find(([, v]) => v.text.includes(key)) ??
      entries.find(([, v]) => key.includes(v.text.slice(0, 10)));
    if (hit) {
      const target = document.getElementById(hit[0]);
      if (target) {
        flash(target);
        return true;
      }
    }
  }
  return false;
}

export default function MindMapViewer({ data, blockMap = {}, mapId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);
  // 拖拽悬停的节点 uid（用于高亮切换）
  const hoverUidRef = useRef<string | null>(null);
  const throttleTimer = useRef<number>(0);
  // 命名弹框
  const [dropDialog, setDropDialog] = useState<DropData | null>(null);
  const [refName, setRefName] = useState('');

  /** 确认：插入引用节点到目标节点下（走 refs API，数据库为准） */
  const confirmDrop = async (): Promise<void> => {
    if (!dropDialog || !mapId) return;
    const dialog = dropDialog;
    const name = refName.trim();
    if (!name) return;
    setDropDialog(null);
    try {
      const res = await fetch(`/api/mindmaps/${mapId}/refs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: name,
          anchorId: dialog.anchorId,
          snippet: dialog.snippet,
          parentId: dialog.targetUid,
        }),
      });
      if (!res.ok) return;
      // 触发画布刷新（effect 内监听的 mindmap-refresh）
      window.dispatchEvent(new CustomEvent('mindmap-refresh', { detail: { mapId } }));
      const toastEl = document.createElement('div');
      toastEl.className =
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-background px-4 py-2 text-xs shadow-lg';
      toastEl.textContent = `已加入「${dialog.targetTitle}」下`;
      document.body.appendChild(toastEl);
      window.setTimeout(() => toastEl.remove(), 2200);
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    let disposed = false;
    let mm: MindMap | null = null;
    let ro: ResizeObserver | null = null;

    /** 节点缓存（渲染实例） */
    const nodeCache = (): Record<string, NodeLike> =>
      (mmRef.current?.renderer as { nodeCache?: Record<string, NodeLike> } | undefined)?.nodeCache ?? {};

    /** 切换悬停高亮 */
    function setHover(uid: string | null): void {
      if (hoverUidRef.current === uid) return;
      const cache = nodeCache();
      if (hoverUidRef.current && cache[hoverUidRef.current]) {
        cache[hoverUidRef.current]?.closeHighlight?.();
      }
      hoverUidRef.current = uid;
      if (uid && cache[uid]) cache[uid]?.highlight?.();
    }

    function clearHover(): void {
      setHover(null);
    }

    /** 鼠标坐标 → 命中的节点 uid（视口坐标直接比较；命中多个时取面积最小 = 最精确） */
    function findNodeAt(clientX: number, clientY: number): string | null {
      const cache = nodeCache();
      let best: { uid: string; area: number } | null = null;
      for (const uid of Object.keys(cache)) {
        const el = cache[uid]?.group?.node as SVGElement | undefined;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const area = r.width * r.height;
          if (!best || area < best.area) best = { uid, area };
        }
      }
      return best?.uid ?? null;
    }

    function nodeTitle(uid: string | null): string {
      if (!uid) return '根节点';
      return nodeCache()[uid]?.getData?.().data?.text?.slice(0, 20) || '该节点';
    }

    /** 拖拽经过画布：感应节点 + 高亮（节流 50ms，但始终用最新鼠标坐标） */
    let lastDragPos = { x: 0, y: 0 };
    function onDragOver(e: DragEvent): void {
      if (!mmRef.current) return;
      e.preventDefault();
      lastDragPos = { x: e.clientX, y: e.clientY };
      if (throttleTimer.current) return;
      throttleTimer.current = window.setTimeout(() => {
        throttleTimer.current = 0;
        const uid = findNodeAt(lastDragPos.x, lastDragPos.y);
        setHover(uid);
      }, 50);
    }

    function onDragLeave(e: DragEvent): void {
      // 移到画布外才清除（子元素间移动不触发）
      if (e.relatedTarget && containerRef.current?.contains(e.relatedTarget as Node)) return;
      clearHover();
    }

    /** 松手：记录落点，弹命名框 */
    function onDrop(e: DragEvent): void {
      if (!mmRef.current) return;
      e.preventDefault();
      clearHover();
      // 用最新坐标立即确认目标节点（节流可能滞后，drop 时实时算一次最准）
      const targetUid = findNodeAt(e.clientX, e.clientY);
      hoverUidRef.current = null;
      // 选区信息：dragstart 时由文章页写入 window.__mindmapDragRef
      const dragRef = (window as unknown as { __mindmapDragRef?: { anchorId?: string; snippet?: string } })
        .__mindmapDragRef;
      const snippet = (e.dataTransfer?.getData('text/plain') || dragRef?.snippet || '').trim();
      if (!snippet && !dragRef?.anchorId) return;
      setDropDialog({
        targetUid,
        targetTitle: nodeTitle(targetUid),
        snippet: snippet || dragRef?.snippet || '',
        anchorId: dragRef?.anchorId,
      });
      setRefName((snippet || dragRef?.snippet || '').slice(0, 30));
    }

    /** 重新拉取并刷新画布（完整格式必须 setFullData） */
    async function refreshMap(): Promise<void> {
      if (!mapId || !mmRef.current) return;
      try {
        const res = await fetch(`/api/mindmaps/${mapId}`);
        if (!res.ok) return;
        const d = (await res.json()) as { map?: { data?: unknown } };
        const next = d.map?.data;
        if (!next) return;
        const mm = mmRef.current as unknown as {
          setFullData?: (data: unknown) => void;
          setData?: (data: unknown) => void;
        };
        if (mm.setFullData) mm.setFullData(next);
        else mm.setData?.(next);
      } catch {
        /* 忽略 */
      }
    }

    function toast(msg: string): void {
      const el = document.createElement('div');
      el.className =
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-background px-4 py-2 text-xs shadow-lg';
      el.textContent = msg;
      document.body.appendChild(el);
      window.setTimeout(() => el.remove(), 2200);
    }

    void (async () => {
      const mod = await import('simple-mind-map');
      if (disposed || !containerRef.current) return;
      // DB 存完整格式（getData(true) 输出）；初始化取 root + 布局/主题
      const full = (data ?? {}) as { root?: unknown; layout?: string; theme?: { template?: string } };
      const rootData = (full.root ?? data) as MindMapData | undefined;
      const instance = new mod.default({
        el: containerRef.current,
        data: rootData,
        layout: typeof full.layout === 'string' ? full.layout : undefined,
        theme: typeof full.theme?.template === 'string' ? full.theme.template : undefined,
        readonly: true,
        // 展开/收起按钮始终显示（默认 hover 才显示，根节点不显示是库设计）
        alwaysShowExpandBtn: true,
        expandBtnSize: 14,
        // 默认滚轮行为（move）：普通滚轮上下移动，按住 Ctrl 滚轮放大缩小
      });
      mm = instance;
      mmRef.current = mm;
      mm.on('node_click', (node) => {
        const d = (node as { nodeData?: { data?: { anchorId?: string; snippet?: string } } })?.nodeData?.data;
        if (!d) return;
        // 只滚动文章跳转，不收起抽屉
        jumpToBlock(d.anchorId, d.snippet, blockMap);
      });
      ro = new ResizeObserver(() => mm?.resize());
      ro.observe(containerRef.current);
    })();

    // 拖拽接收（容器级）
    const container = containerRef.current;
    container?.addEventListener('dragover', onDragOver);
    container?.addEventListener('drop', onDrop);
    container?.addEventListener('dragleave', onDragLeave);

    /** 外部新增引用节点后：重新拉取并刷新画布 */
    async function onRefresh(): Promise<void> {
      await refreshMap();
    }
    window.addEventListener('mindmap-refresh', onRefresh);

    return () => {
      disposed = true;
      window.clearTimeout(throttleTimer.current);
      ro?.disconnect();
      mmRef.current = null;
      clearHover();
      container?.removeEventListener('dragover', onDragOver);
      container?.removeEventListener('drop', onDrop);
      container?.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('mindmap-refresh', onRefresh);
    };
  }, [data, blockMap, mapId]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* 命名弹框（拖拽松手后弹出，不是粘贴全文） */}
      {dropDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDropDialog(null)}
        >
          <div
            className="w-80 rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="给引用命名"
          >
            <h3 className="font-medium">添加引用</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              将添加到「{dropDialog.targetTitle}」下
            </p>
            <label className="mt-3 block text-xs font-medium text-muted-foreground">
              引用名称（节点显示用，不是粘贴全文）
              <input
                type="text"
                value={refName}
                onChange={(e) => setRefName(e.target.value)}
                maxLength={80}
                autoFocus
                placeholder="给这个引用起个名字"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring"
              />
            </label>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDropDialog(null)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDrop()}
                disabled={!refName.trim()}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
