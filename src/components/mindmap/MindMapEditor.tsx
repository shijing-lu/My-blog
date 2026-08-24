/**
 * MindMapEditor.tsx —— 思维导图编辑器（管理端，simple-mind-map 核心库）
 *
 * - 动态 import simple-mind-map（避免打进无关页面包）；
 * - 数据变化（data_change / view_data_change）→ 1.5s 防抖自动保存；
 * - 响应工具栏的导出事件（custom event mindmap-export），由核心库 export 完成下载；
 * - 数据格式：getData(true) 全量（layout/root/theme/view）→ PUT /api/mindmaps/[id]。
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
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const SAVE_DELAY = 1500;

export default function MindMapEditor({ mapId, initialData }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<MindMap | null>(null);
  const saveTimer = useRef<number>(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');

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
      mm.on('data_change', scheduleSave);
      mm.on('view_data_change', scheduleSave);
      ro = new ResizeObserver(() => mm?.resize());
      ro.observe(containerRef.current);
    })();

    function scheduleSave(): void {
      setSaveState('dirty');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void doSave(), SAVE_DELAY);
    }

    async function doSave(): Promise<void> {
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">
        {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存…' : '保存失败'}
      </span>
    </div>
  );
}
