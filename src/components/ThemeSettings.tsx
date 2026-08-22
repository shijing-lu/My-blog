/**
 * ThemeSettings.tsx —— 主题设置面板（React 岛）
 *
 * 通过页头的「调色盘」按钮打开；提供主题风格选择（卡片 + 色板预览）与
 * 外观模式（亮 / 暗 / 跟随系统）切换；选择即写入 localStorage 并全局生效。
 */
import { useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { Sun, Moon, Monitor, Palette } from 'lucide-react';
import { themes } from '@/themes';
import { readState, writeState, type ThemeMode, type ThemeState } from '@/lib/theme';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** 外观模式选项 */
const MODES: ReadonlyArray<{ value: ThemeMode; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

/** 主题设置面板 */
export default function ThemeSettings(): ReactElement {
  const [state, setState] = useState<ThemeState>(() => readState());
  const [open, setOpen] = useState(false);

  /** 应用并持久化新状态 */
  const apply = (next: ThemeState): void => {
    setState(next);
    writeState(next);
  };

  /** 主题在界面上的取值（默认主题用空串表示） */
  const themeValue = (id: string, isDefault: boolean | undefined): string => (isDefault ? '' : id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="主题设置">
          <Palette className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>主题设置</DialogTitle>
          <DialogDescription>选择全局风格与外观模式，即时生效并自动记住。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {themes.map((t) => {
            const value = themeValue(t.id, t.isDefault);
            const active = state.themeId === value;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => apply({ ...state, themeId: value })}
                className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                  active ? 'border-primary bg-accent' : 'hover:bg-accent'
                }`}
              >
                <div className="flex shrink-0 overflow-hidden rounded-md border shadow-sm">
                  {t.preview.map((color, i) => (
                    <span key={i} className="size-6" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    {t.isDefault ? <Badge variant="outline">默认</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                </div>
                {active ? <span className="size-2.5 shrink-0 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">外观模式</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const active = state.mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => apply({ ...state, mode: m.value })}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                    active ? 'border-primary bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <m.icon className="size-4" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
