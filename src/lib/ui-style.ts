/** Public style values shared by the server and the browser. */
export type UiStyle = 'classic' | 'material3';
export type UiStylePreference = UiStyle | 'inherit';
export interface UiStyleSettings { defaultStyle: UiStyle }
export const UI_STYLE_SETTINGS_KEY = 'ui_style';

export function isUiStyle(value: unknown): value is UiStyle {
  return value === 'classic' || value === 'material3';
}

export function normalizeUiStylePreference(value: unknown): UiStylePreference {
  return isUiStyle(value) ? value : 'inherit';
}

export function resolveUiStyle(preference: unknown, siteDefault: unknown): UiStyle {
  if (isUiStyle(preference)) return preference;
  return isUiStyle(siteDefault) ? siteDefault : 'classic';
}
