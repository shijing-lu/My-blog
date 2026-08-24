/**
 * MindMapViewer.tsx —— 思维导图只读查看器（文章页抽屉）
 *
 * - readonly 渲染（同一 simple-mind-map 数据格式，与编辑器一致）；
 * - 点击带锚点（node.data.anchorId）的节点 → 先派发 mindmap-navigate（页面收起
 *   移动端全屏抽屉），再平滑滚动文章对应段落并闪烁高亮；锚点失效用 blockMap
 *   摘要包含匹配兜底；
 * - 监听 mindmap-refresh：外部新增引用节点后重新拉取数据刷新画布。
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
  /** 导图 id（mindmap-refresh 时重新拉取数据用） */
  mapId?: string;
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

export default function MindMapViewer({ data, blockMap = {}, mapId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let mm: MindMap | null = null;
    let ro: ResizeObserver | null = null;

    void (async () => {
      const mod = await import('simple-mind-map');
      if (disposed || !containerRef.current) return;
      const instance = new mod.default({
        el: containerRef.current,
        data: data as MindMapData | undefined,
        readonly: true,
        layout: 'logicalStructure',
        theme: 'default',
        // 默认滚轮行为（move）：普通滚轮上下移动，按住 Ctrl 滚轮放大缩小
      });
      mm = instance;
      mmRef.current = mm;
      mm.on('node_click', (node) => {
        const anchorId = (node as { nodeData?: { data?: { anchorId?: string } } })?.nodeData?.data?.anchorId;
        if (!anchorId) return;
        // 移动端抽屉全屏：先派发导航事件让页面收起抽屉，再延迟滚动
        window.dispatchEvent(new Event('mindmap-navigate'));
        window.setTimeout(() => {
          jumpToAnchor(anchorId, blockMap);
        }, 260);
      });
      ro = new ResizeObserver(() => mm?.resize());
      ro.observe(containerRef.current);
    })();

    /** 外部新增引用节点后：重新拉取并刷新画布 */
    async function onRefresh(): Promise<void> {
      if (!mapId) return;
      try {
        const res = await fetch(`/api/mindmaps/${mapId}`);
        if (!res.ok) return;
        const d = (await res.json()) as { map?: { data?: unknown } };
        const next = d.map?.data;
        if (next && mmRef.current) {
          mmRef.current.setData(next as MindMapData);
        }
      } catch {
        /* 忽略刷新失败 */
      }
    }
    window.addEventListener('mindmap-refresh', onRefresh);

    return () => {
      disposed = true;
      ro?.disconnect();
      mmRef.current = null;
      window.removeEventListener('mindmap-refresh', onRefresh);
    };
  }, [data, blockMap, mapId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
