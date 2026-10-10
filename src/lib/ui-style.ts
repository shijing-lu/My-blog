/** The sole visual language; mode remains a separate preference. */
export type UiStyle = 'neobrutalism';
export type UiStylePreference = UiStyle | 'inherit';
export interface UiStyleSettings { defaultStyle: UiStyle }
export const UI_STYLE_SETTINGS_KEY = 'ui_style';
export const DEFAULT_UI_STYLE: UiStyle = 'neobrutalism';
export function isUiStyle(value: unknown): value is UiStyle { return value === DEFAULT_UI_STYLE; }
export function normalizeUiStylePreference(_value: unknown): UiStylePreference { return 'inherit'; }
export function resolveUiStyle(_preference: unknown, _siteDefault: unknown): UiStyle { return DEFAULT_UI_STYLE; }
