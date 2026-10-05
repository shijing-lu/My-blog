import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCadenceAppearance } from '@/cadence/shared/lib/site-appearance';

const theme = vi.hoisted(() => ({
  read: vi.fn(() => ({ themeId: 'existing-custom', mode: 'dark' as 'light' | 'dark' | 'system', uiStyle: 'material3' })),
  write: vi.fn(),
}));
vi.mock('@/lib/theme', () => ({ readState: theme.read, writeState: theme.write }));
import { useAppearanceStore } from '@/cadence/shared/store/appearance-store';

afterEach(() => {
  theme.write.mockClear();
  theme.read.mockReturnValue({ themeId: 'existing-custom', mode: 'dark', uiStyle: 'material3' });
});

describe('Cadence appearance follows the site', () => {
  it('changes module motion without replacing the site theme or style', () => {
    const root = {
      dataset: { theme: 'existing-custom', uiStyle: 'material3', mode: 'dark' },
      style: { setProperty: vi.fn() },
    };
    applyCadenceAppearance(root as unknown as HTMLElement, 'off', 'subtle');
    expect(root.dataset).toEqual({
      theme: 'existing-custom', uiStyle: 'material3', mode: 'dark', texture: 'off', motion: 'subtle',
    });
    expect(root.style.setProperty).toHaveBeenCalledWith('--motion-scale', '0.6');
  });

  it('an explicit Cadence mode choice preserves the full site preference', () => {
    useAppearanceStore.getState().setTheme('light');
    expect(theme.write).toHaveBeenCalledOnce();
    expect(theme.write).toHaveBeenCalledWith({
      themeId: 'existing-custom', mode: 'light', uiStyle: 'material3',
    });
    expect(useAppearanceStore.getState().theme).toBe('light');
  });

  it('reset restores module defaults while retaining the authoritative site mode', () => {
    useAppearanceStore.getState().setMotion('off');
    useAppearanceStore.getState().setTexture('off');
    useAppearanceStore.getState().reset();
    const state = useAppearanceStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.motion).toBe('full');
    expect(state.texture).toBe('full');
    expect(theme.write).not.toHaveBeenCalled();
  });
});
