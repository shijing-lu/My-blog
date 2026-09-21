/**
 * EditorShortcutsSettings —— Markdown 编辑器快捷键自定义（设置页岛组件）
 *
 * 交互（与 Obsidian 的 Hotkeys 设置习惯一致）：
 * - 列表按「格式 / 标题 / 块结构」分组，显示功能名与当前绑定
 * - 点「录制」后按下组合键即完成改绑（Esc 取消；仅修饰键忽略）
 * - 「恢复默认」清除该项自定义
 * - 冲突实时检测：同一组合键绑定到多个命令时红字提示并阻止保存
 * - 受浏览器保留键影响的项目（Mod-1..6）有标注：Web 标签页中无法拦截，桌面端不受影响
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EDITOR_SHORTCUT_DEFS,
  bindingFromEvent,
  normalizeBinding,
  resolveBindings,
  type ShortcutDef,
} from '@/lib/editor-shortcut-defs';

interface ApiShape {
  custom: Record<string, string>;
  bindings: Record<string, string>;
  conflicts: Array<{ binding: string; ids: string[] }>;
}

/** 展示用格式化：Mod-b → Ctrl+B（Mac 由用户理解；桌面端是 Windows） */
function pretty(binding: string): string {
  return binding
    .split('-')
    .map((p) => (p === 'mod' ? 'Ctrl' : p === 'shift' ? 'Shift' : p === 'alt' ? 'Alt' : p.toUpperCase()))
    .join(' + ');
}

export default function EditorShortcutsSettings() {
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const { conflicts } = useMemo(() => resolveBindings(custom), [custom]);

  /** 载入当前自定义 */
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/editor-shortcuts', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ApiShape;
        setCustom(data.custom ?? {});
      } catch {
        setError('加载失败（离线或未登录）');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  /** 录制：捕获按键组合 */
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const binding = bindingFromEvent(e);
      if (!binding) return; // 仅修饰键：等待完整组合
      setCustom((prev) => ({ ...prev, [recording]: binding }));
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [recording]);

  const save = useCallback(
    async (next: Record<string, string>) => {
      setSaving(true);
      setError('');
      try {
        const res = await fetch('/api/editor-shortcuts', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ custom: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSavedAt(Date.now());
      } catch {
        setError('保存失败（离线或未登录）');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const onReset = useCallback(
    (id: string) => {
      const next = { ...custom };
      delete next[id];
      setCustom(next);
      void save(next);
    },
    [custom, save],
  );

  const groups = ['格式', '标题', '块结构'] as const;

  const row = (def: ShortcutDef) => {
    const isCustom = Boolean(custom[def.id]);
    const binding = normalizeBinding(custom[def.id]) ?? def.binding;
    return (
      <div
        key={def.id}
        className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
      >
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{def.label}</p>
          {def.browserReserved ? (
            <p className="text-xs text-muted-foreground">浏览器标签页会占用（Ctrl+数字切换标签），仅桌面端可用</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setRecording(def.id)}
            className={`min-w-28 rounded-md border px-2 py-1 text-center font-mono text-xs transition-colors ${
              recording === def.id
                ? 'border-primary bg-primary/10 text-primary'
                : isCustom
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent'
            }`}
            title={isCustom ? '已自定义（点击重新录制）' : '默认（点击录制自定义）'}
          >
            {recording === def.id ? '按下组合键…' : pretty(binding)}
          </button>
          {isCustom ? (
            <button
              type="button"
              onClick={() => onReset(def.id)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              恢复默认
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-medium text-foreground">编辑器快捷键</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          与 Obsidian 一致的 Markdown 格式快捷键；点「录制」后按下新组合键即可改绑，Esc 取消。
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          快捷键冲突：{conflicts.map((c) => `${pretty(c.binding)}（${c.ids.join(' / ')}）`).join('、')} —— 请调整后再保存
        </p>
      ) : null}

      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">{g}</h3>
          <div className="rounded-lg border border-border bg-card">
            {EDITOR_SHORTCUT_DEFS.filter((d) => d.group === g).map(row)}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || conflicts.length > 0 || !loaded}
          onClick={() => void save(custom)}
          className="rounded-md border border-primary/40 bg-primary/10 px-4 py-1.5 text-sm text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={saving || Object.keys(custom).length === 0}
          onClick={() => {
            setCustom({});
            void save({});
          }}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          全部恢复默认
        </button>
        {savedAt > 0 && !saving ? <span className="text-xs text-muted-foreground">已保存，编辑器下次打开生效</span> : null}
      </div>

      <p className="text-xs text-muted-foreground">
        说明：改绑保存在服务端（跟随账号/本机数据），对所有 Markdown 编辑器生效；保存后重新打开编辑器即应用。
      </p>
    </div>
  );
}
