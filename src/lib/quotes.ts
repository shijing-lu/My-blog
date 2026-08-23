/**
 * 首页 Hero 古诗词/名言轮播配置
 *
 * 自定义方法：增删 `HERO_QUOTES` 数组里的条目即可（任意条），
 * 每条可单独设置 `pauseMs`（全部文字显示完后的停留时间，毫秒），
 * 不设置则用默认 `QUOTE_PAUSE_MS`。
 * 逐字出现的间隔与闪烁次数见下方常量，可全局调整。
 */

/** 一条名言 */
export interface QuoteConfig {
  /** 名言文本（逐字展示，含标点） */
  text: string;
  /** 全部显示后的停留时间（毫秒）；缺省用 QUOTE_PAUSE_MS */
  pauseMs?: number;
}

/** 默认逐字间隔（毫秒）：每字出现/消失的节奏 */
export const QUOTE_CHAR_INTERVAL_MS = 480;
/** 默认全部显示后的停留时间（毫秒） */
export const QUOTE_PAUSE_MS = 4600;

/** 首页轮播的古诗词/名言列表（可自定义任意条） */
export const HERO_QUOTES: QuoteConfig[] = [
  { text: '落霞与孤鹜齐飞，秋水共长天一色', pauseMs: 4200 },
  { text: '人生若只如初见，何事秋风悲画扇' },
  { text: '山重水复疑无路，柳暗花明又一村' },
  { text: '海内存知己，天涯若比邻' },
  { text: '会当凌绝顶，一览众山小' },
];
