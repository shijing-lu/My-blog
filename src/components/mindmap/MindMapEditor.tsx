/**
 * MindMapEditor.tsx —— 思维导图编辑器（管理端，simple-mind-map 核心库）
 *
 * - 动态 import simple-mind-map（避免打进无关页面包）；
 * - 数据变化（data_change / view_data_change）→ 1.5s 防抖自动保存；
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

const SAVE_DELAY = 1500;

export default function MindMapEditor({ mapId, initialData, blockMap = {} }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);
  const saveTimer = useRef<number>(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastError, setLastError] = useState<string | null>(null);
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
      // DB 存的是完整格式（getData(true) 输出 { layout, root, theme, view }）；
      // 初始化需取 root 作为节点树 + 单独传布局/主题（new MindMap 的 data 只接受节点树）
      const full = (data ?? {}) as { root?: unknown; layout?: string; theme?: { template?: string } };
      const rootData = (full.root ?? data) as MindMapData | undefined;
      const instance = new mod.default({
        el: containerRef.current,
        data: rootData,
        layout: typeof full.layout === 'string' ? full.layout : undefined,
        theme: typeof full.theme?.template === 'string' ? full.theme.template : undefined,
        // 默认滚轮行为（move）：普通滚轮上下移动，按住 Ctrl 滚轮放大缩小
      });
      mm = instance;
      mmRef.current = mm;
      mm.on('data_change', () => {
        scheduleSave();
        recomputeBroken();
      });
      mm.on('view_data_change', scheduleSave);
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

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer.current);
      ro?.disconnect();
      mmRef.current = null;
      mm?.destroy?.();
      document.removeEventListener('mindmap-export', onExport);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, initialData]);

  /** 立即保存当前导图数据（防抖保存 / 手动保存 / 状态设置后共用） */
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
      if (res.ok) {
        setSaveState('saved');
        setLastError(null);
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveState('error');
      setLastError(d.error ?? `保存失败（HTTP ${res.status}）`);
    } catch (err) {
      setSaveState('error');
      setLastError(err instanceof Error ? err.message : '网络错误，保存失败');
    }
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* 右上角：保存状态 + 手动保存 */}
      <div className="absolute right-3 top-2 flex items-center gap-2 text-xs">
        <span
          className={
            saveState === 'saved'
              ? 'text-emerald-600'
              : saveState === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground'
          }
        >
          {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存…' : '保存失败'}
        </span>
        <button
          type="button"
          onClick={() => void saveNow()}
          disabled={saveState === 'saving'}
          className="rounded-md border border-border px-2.5 py-0.5 transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          保存
        </button>
      </div>
      {lastError && (
        <div className="absolute left-1/2 top-10 z-10 max-w-md -translate-x-1/2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          保存失败：{lastError}
        </div>
      )}
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
    </div>
  );
}
