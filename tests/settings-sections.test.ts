import { describe, expect, it } from 'vitest';
import { getSettingsSections } from '../src/lib/settings-sections';

describe('shared settings navigation', () => {
  it('keeps all section ids and routes unique', () => {
    const sections = getSettingsSections(true);
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length);
    expect(new Set(sections.map(section => section.href)).size).toBe(sections.length);
    expect(sections.find(section => section.id === 'shortcuts')?.href).toBe('/admin/settings/editor-shortcuts');
  });
  it('only exposes local-cloud sync for a local runtime', () => {
    expect(getSettingsSections(false).some(section => section.id === 'sync')).toBe(false);
    expect(getSettingsSections(true).some(section => section.id === 'sync')).toBe(true);
  });
  it('makes the new appearance setting discoverable by name and keywords', () => {
    const appearance = getSettingsSections(false).find(section => section.id === 'appearance');
    expect(appearance?.label).toBe('外观');
    for (const keyword of ['新粗野主义', 'neobrutalism', '明暗', '系统', '字体', '背景']) expect(appearance?.keywords).toContain(keyword);
  });
});
