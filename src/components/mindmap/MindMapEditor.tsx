/**
 * MindMapEditor.tsx —— 思维导图编辑器（管理端，simple-mind-map 核心库）
 *
 * - 动态 import simple-mind-map（避免打进无关页面包）；
 * - 数据变化（data_change / view_data_change）→ 1.5s 防抖自动保存；
 * - 节点右键菜单：标记学习状态（已掌握/学习中/存疑/清除），状态存节点 data.status，
 *   节点 group 加 mm-status-* class（角标着色）；
 * - 失效引用检测：节点 anchorId 不在文章 blockMap 中时列入失效列表（工具提示）；
 * - 工具栏导出（custom event mindmap-export）由核心库 export 完成下载；
 * - 数据格式：getData(true) 全量 → PUT /api/mindmaps/[id]。
 */
import { useEffect, useRef, useState } from 'react';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import type MindMap from 'simple-mind-map';
import type { MindMapData } from 'simple-mind-map';

interface Props {
  mapId: string;
  initialTitle: string;
  /** simple-mind-map 全量数据 JSON 字符串 */
  initialData: string;
  /** 绑定文章的块级锚点映射（para-N → 块信息；用于失效引用检测） */
  blockMap?: Record<string, { type: string; text: string }>;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/** 学习状态定义 */
const STATUS_OPTIONS = [
  { value: 'mastered', label: '✅ 已掌握', cls: 'mm-status-mastered' },
  { value: 'learning', label: '📖 学习中', cls: 'mm-status-learning' },
  { value: 'doubt', label: '❓ 存疑', cls: 'mm-status-doubt' },
] as const;

const SAVE_DELAY = 1500;

export default function MindMapEditor({ mapId, initialData, blockMap = {} }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);
  const saveTimer = useRef<number>(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // 右键菜单：位置 + 当前节点
  const [menu, setMenu] = useState<{ x: number; y: number; node: MindMapNodeLike } | null>(null);
  // 失效引用列表
  const [brokenRefs, setBrokenRefs] = useState<{ uid: string; text: string; anchorId: string }[]>([]);

  useEffect(() => {
    let disposed = false;
    let mm: MindMap | null = null;
    let ro: ResizeObserver | null = null;

    void (async () => {
      const mod = await import('simple-mind-map');
      if (disposed || !containerRef.current) return;
      let data: unknown;
      try {
        data = JSON.parse(initialData);
      } catch {
        data = undefined;
      }
      const instance = new mod.default({
        el: containerRef.current,
        data: data as MindMapData | undefined,
        layout: 'logicalStructure',
        theme: 'default',
        mousewheelAction: 'zoom',
      });
      mm = instance;
      mmRef.current = mm;
      mm.on('data_change', () => {
        scheduleSave();
        recomputeBroken();
      });
      mm.on('view_data_change', scheduleSave);
      // 右键 → 状态菜单（阻止默认菜单）
      mm.on('node_contextmenu', (e, node) => {
        const ev = e as MouseEvent;
        ev.preventDefault();
        setMenu({ x: ev.clientX, y: ev.clientY, node: node as MindMapNodeLike });
      });
      ro = new ResizeObserver(() => mm?.resize());
      ro.observe(containerRef.current);
      recomputeBroken();
    })();

    function scheduleSave(): void {
      setSaveState('dirty');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveNow(), SAVE_DELAY);
    }

    /** 失效引用检测：节点有 anchorId 但文章块映射中不存在 */
    function recomputeBroken(): void {
      const current = mmRef.current;
      if (!current) return;
      const cache = (current.renderer as { nodeCache?: Record<string, { getData: () => unknown }> }).nodeCache ?? {};
      const broken: { uid: string; text: string; anchorId: string }[] = [];
      Object.values(cache).forEach((node) => {
        const d = (node.getData() ?? {}) as { data?: Record<string, unknown> };
        const data = d.data;
        if (!data || typeof data.anchorId !== 'string') return;
        if (!(data.anchorId in blockMap)) {
          broken.push({
            uid: typeof data.uid === 'string' ? data.uid : '',
            text: typeof data.text === 'string' ? data.text.slice(0, 30) : '',
            anchorId: data.anchorId,
          });
        }
      });
      setBrokenRefs(broken);
    }

    // 工具栏导出（由页面 script 派发）
    function onExport(e: Event): void {
      const type = (e as CustomEvent<{ type: 'png' | 'svg' | 'md' | 'json' }>).detail?.type;
      if (!type || !mmRef.current) return;
      void mmRef.current.export(type).catch(() => {
        setSaveState('error');
      });
    }
    document.addEventListener('mindmap-export', onExport);
    document.addEventListener('click', () => setMenu(null));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(null);
    });

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer.current);
      ro?.disconnect();
      mmRef.current = null;
      mm?.destroy?.();
      document.removeEventListener('mindmap-export', onExport);
      document.removeEventListener('click', () => setMenu(null));
      document.removeEventListener('keydown', () => setMenu(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, initialData]);

  /** 立即保存当前导图数据（防抖保存 / 状态设置后共用） */
  async function saveNow(): Promise<void> {
    const current = mmRef.current;
    if (!current) return;
    setSaveState('saving');
    try {
      const data = JSON.stringify(current.getData(true));
      const res = await fetch(`/api/mindmaps/${mapId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      setSaveState(res.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  }

  /** 设置节点学习状态（写 node.data.status + 更新角标 class + 触发保存） */
  function applyStatus(value: string | null): void {
    if (!menu) return;
    const node = menu.node;
    const data = (node.getData?.() ?? node.data) as { data?: Record<string, unknown> } | undefined;
    const d = data?.data;
    if (!d) return;
    if (value) {
      d.status = value;
    } else {
      delete d.status;
    }
    // 更新 group 角标 class
    ['mm-status-mastered', 'mm-status-learning', 'mm-status-doubt'].forEach((c) => node.group?.removeClass?.(c));
    if (value) node.group?.addClass?.(`mm-status-${value}`);
    node.reRender?.();
    setMenu(null);
    // 手动触发保存（直接改 node.data 不会触发 data_change）
    const current = mmRef.current;
    if (current) {
      setSaveState('dirty');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveNow(), SAVE_DELAY);
    }
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">
        {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存…' : '保存失败'}
      </span>
      {/* 失效引用提示 */}
      {brokenRefs.length > 0 && (
        <div className="absolute left-3 top-2 z-10 flex flex-col gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span>
            ⚠️ 失效引用 {brokenRefs.length} 处（文章已改，锚点不存在）
          </span>
          <ul className="max-h-24 overflow-y-auto pl-3">
            {brokenRefs.slice(0, 8).map((b) => (
              <li key={b.uid} className="list-disc truncate">
                {b.text || b.anchorId}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* 右键状态菜单 */}
      {menu && (
        <div
          className="fixed z-50 min-w-32 rounded-lg border border-border bg-card p-1 shadow-lg"
          style={{ left: Math.min(menu.x, window.innerWidth - 150), top: Math.min(menu.y, window.innerHeight - 160) }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-2 py-1 text-[0.6rem] uppercase tracking-wider text-muted-foreground">学习状态</p>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => applyStatus(s.value)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => applyStatus(null)}
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            清除状态
          </button>
        </div>
      )}
    </div>
  );
}

/** 编辑器内用到的节点实例形状（simple-mind-map MindMapNode 子集） */
interface MindMapNodeLike {
  getData?: () => unknown;
  data?: { data?: Record<string, unknown> };
  group?: { addClass?: (c: string) => void; removeClass?: (c: string) => void };
  reRender?: () => void;
}
