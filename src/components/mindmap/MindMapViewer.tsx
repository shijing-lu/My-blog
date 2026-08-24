/**
 * MindMapViewer.tsx —— 思维导图只读查看器（文章页抽屉）
 *
 * - readonly 模式渲染（同一 simple-mind-map 数据格式，与编辑器一致）；
 * - 点击带锚点（node.data.anchorId）的节点 → 平滑滚动文章对应段落并闪烁高亮；
 *   锚点失效时用 blockMap 摘要做包含匹配兜底；
 * - 导航前派发 window 事件 mindmap-navigate（页面脚本据此收起移动端抽屉）。
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
}

/** 导航到文章锚点（含失效兜底）；返回是否定位成功 */
function jumpToAnchor(anchorId: string, blockMap: Record<string, BlockInfo>): boolean {
  const el = document.getElementById(anchorId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mind-anchor-flash');
    window.setTimeout(() => el.classList.remove('mind-anchor-flash'), 2200);
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
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('mind-anchor-flash');
        window.setTimeout(() => target.classList.remove('mind-anchor-flash'), 2200);
        return true;
      }
    }
  }
  return false;
}

export default function MindMapViewer({ data, blockMap = {} }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

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
        mousewheelAction: 'zoom',
      });
      mm = instance;
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

    return () => {
      disposed = true;
      ro?.disconnect();
    };
  }, [data, blockMap]);

  return <div ref={containerRef} className="h-full w-full" />;
}
