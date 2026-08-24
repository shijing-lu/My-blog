/**
 * MindMapViewer.tsx —— 思维导图只读查看器（文章页抽屉 / 学习模式）
 *
 * - readonly 渲染（同一 simple-mind-map 数据格式，与编辑器一致）；
 * - 点击带锚点（node.data.anchorId）的节点 → 平滑滚动文章对应段落并闪烁高亮，
 *   锚点失效用 blockMap 摘要包含匹配兜底；
 * - 节点状态角标：data.status（mastered/learning/doubt）→ 节点 group 加 class；
 * - 学习模式（mode="learn"）：
 *   - 不派发「收起抽屉」事件；
 *   - 监听 window「mindmap-focus-node」→ 定位并高亮指定 uid 节点（展开祖先 + 居中）；
 *   - 监听 window「mindmap-review」→ 折叠全部子节点（遮盖式回忆）；
 * - drawer 模式：点击锚点节点先派发 mindmap-navigate（页面据此收起移动端抽屉）。
 */
import { useEffect, useRef } from 'react';
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
  /** drawer=文章页抽屉（点击节点先收抽屉）；learn=学习模式双栏 */
  mode?: 'drawer' | 'learn';
}

/** 导航到文章锚点（含失效兜底）；返回是否定位成功 */
function jumpToAnchor(anchorId: string, blockMap: Record<string, BlockInfo>): boolean {
  const flash = (el: HTMLElement): void => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mind-anchor-flash');
    window.setTimeout(() => el.classList.remove('mind-anchor-flash'), 2200);
  };
  const el = document.getElementById(anchorId);
  if (el) {
    flash(el);
    return true;
  }
  // 锚点失效（文章改过）：用块摘要包含匹配兜底
  const info = blockMap[anchorId];
  if (info && info.text) {
    const entries = Object.entries(blockMap);
    const key = info.text.slice(0, 20);
    const hit = entries.find(([, v]) => v.text.includes(key)) ?? entries.find(([, v]) => key.includes(v.text.slice(0, 10)));
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

/** 递归遍历节点（渲染实例），收集 uid → status / anchorId 映射 */
function collectNodeMeta(mm: MindMap): Map<string, { status?: string; anchorId?: string }> {
  const meta = new Map<string, { status?: string; anchorId?: string }>();
  const cache = (mm.renderer as { nodeCache?: Record<string, { getData: () => unknown; data?: { data?: Record<string, unknown> } }> }).nodeCache ?? {};
  Object.values(cache).forEach((node) => {
    const d = (node.getData?.() ?? node.data) as { data?: Record<string, unknown> } | undefined;
    const data = d?.data;
    const uid = typeof data?.uid === 'string' ? data.uid : '';
    if (!uid) return;
    const status = typeof data?.status === 'string' ? data.status : undefined;
    const anchorId = typeof data?.anchorId === 'string' ? data.anchorId : undefined;
    if (status || anchorId) meta.set(uid, { status, anchorId });
  });
  return meta;
}

export default function MindMapViewer({ data, blockMap = {}, mode = 'drawer' }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let mm: MindMap | null = null;
    let ro: ResizeObserver | null = null;

    /** 展开祖先链并居中高亮节点 */
    function focusNode(uid: string): void {
      const renderer = mm?.renderer as
        | { findNodeByUid: (id: string) => unknown; moveNodeToCenter: (n: unknown) => void }
        | undefined;
      const cache = (mm?.renderer as { nodeCache?: Record<string, { parent?: unknown; showChildren?: () => void; highlight?: () => void }> }).nodeCache;
      if (!renderer || !cache) return;
      const node = renderer.findNodeByUid(uid);
      if (!node) return;
      // 展开祖先链
      let cur: unknown = node;
      let guard = 0;
      while (cur && guard < 40) {
        const n = cur as { parent?: unknown; showChildren?: () => void; getData?: () => { data?: { expand?: boolean } } };
        if (n.parent && n.showChildren && n.getData?.().data?.expand === false) {
          try {
            n.showChildren();
          } catch {
            /* 忽略 */
          }
        }
        cur = n.parent;
        guard += 1;
      }
      try {
        renderer.moveNodeToCenter(node);
      } catch {
        /* 忽略 */
      }
      const n2 = node as { highlight?: () => void; closeHighlight?: () => void };
      n2.highlight?.();
      window.setTimeout(() => n2.closeHighlight?.(), 1800);
    }

    /** 折叠全部子节点（复习模式） */
    function reviewAll(): void {
      const cache = (mm?.renderer as { nodeCache?: Record<string, { hideChildren?: () => void; getData?: () => { data?: { expand?: boolean } } }> }).nodeCache;
      if (!cache) return;
      Object.values(cache).forEach((node) => {
        if (node.hideChildren && node.getData?.().data?.expand !== false) {
          try {
            node.hideChildren();
          } catch {
            /* 忽略 */
          }
        }
      });
    }

    /** 节点状态角标 class */
    function applyStatusClasses(): void {
      if (!mm) return;
      const meta = collectNodeMeta(mm);
      const cache = (mm.renderer as { nodeCache?: Record<string, { group?: { addClass: (c: string) => void; removeClass: (c: string) => void } }> }).nodeCache ?? {};
      Object.entries(meta).forEach(([uid, m]) => {
        const node = cache[uid];
        if (!node?.group) return;
        ['mm-status-mastered', 'mm-status-learning', 'mm-status-doubt'].forEach((c) => node.group?.removeClass(c));
        if (m.status) node.group.addClass(`mm-status-${m.status}`);
      });
    }

    void (async () => {
      const mod = await import('simple-mind-map');
      if (disposed || !containerRef.current) return;
      const instance = new mod.default({
        el: containerRef.current,
        data: data as MindMapData | undefined,
        readonly: true,
        layout: 'logicalStructure',
        theme: 'default',
        mousewheelAction: 'zoom',
      });
      mm = instance;
      mmRef.current = mm;
      mm.on('node_click', (node) => {
        const anchorId = (node as { nodeData?: { data?: { anchorId?: string } } })?.nodeData?.data?.anchorId;
        if (!anchorId) return;
        if (mode === 'drawer') {
          // 移动端抽屉全屏：先派发导航事件让页面收起抽屉，再延迟滚动
          window.dispatchEvent(new Event('mindmap-navigate'));
          window.setTimeout(() => {
            jumpToAnchor(anchorId, blockMap);
          }, 260);
        } else {
          jumpToAnchor(anchorId, blockMap);
        }
      });
      ro = new ResizeObserver(() => mm?.resize());
      ro.observe(containerRef.current);
      applyStatusClasses();
      // 数据渲染完成后再应用状态类（简单延时兜底）
      window.setTimeout(applyStatusClasses, 300);
    })();

    function onFocusNode(e: Event): void {
      const uid = (e as CustomEvent<{ uid: string }>).detail?.uid;
      if (uid) focusNode(uid);
    }
    function onReview(): void {
      reviewAll();
    }
    window.addEventListener('mindmap-focus-node', onFocusNode);
    window.addEventListener('mindmap-review', onReview);

    return () => {
      disposed = true;
      ro?.disconnect();
      window.removeEventListener('mindmap-focus-node', onFocusNode);
      window.removeEventListener('mindmap-review', onReview);
    };
  }, [data, blockMap, mode]);

  return <div ref={containerRef} className="h-full w-full" />;
}
