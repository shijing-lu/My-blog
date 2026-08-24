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

  useEffect(() => {
    let disposed = false;
    let mm: MindMap | null = null;
    let ro: ResizeObserver | null = null;

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

    /** 外部新增引用节点后：重新拉取并刷新画布 */
    async function onRefresh(): Promise<void> {
      if (!mapId) return;
      try {
        const res = await fetch(`/api/mindmaps/${mapId}`);
        if (!res.ok) return;
        const d = (await res.json()) as { map?: { data?: unknown } };
        const next = d.map?.data;
        if (!next || !mmRef.current) return;
        // 完整格式（{ layout, root, theme, view }）必须用 setFullData 恢复；
        // setData 只接受节点树，误用会把整个数据嵌套成根节点链（历史损坏根因）
        const mm = mmRef.current as unknown as {
          setFullData?: (data: unknown) => void;
          setData?: (data: unknown) => void;
        };
        if (mm.setFullData) mm.setFullData(next);
        else mm.setData?.(next);
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
