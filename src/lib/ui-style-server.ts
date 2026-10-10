import { DEFAULT_UI_STYLE, isUiStyle, type UiStyle } from './ui-style';
/** Ignore obsolete settings rows without modifying existing data. */
export async function getSiteUiStyle(_options: { fallbackOnError?: boolean } = {}): Promise<UiStyle> { return DEFAULT_UI_STYLE; }
/** Compatibility route: the unique style is immutable; the route checks authorization. */
export async function saveSiteUiStyle(style: UiStyle): Promise<UiStyle> {
  if (!isUiStyle(style)) throw new TypeError('Invalid UI style');
  return DEFAULT_UI_STYLE;
}
