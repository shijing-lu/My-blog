/**
 * 从自然语言事项里提取预估时长
 * ---------------------------------------------------------------------------
 * 用户说"背单词：一个半小时"，清单标题应该是"背单词"，
 * 时长进 estimateMinutes —— 而不是把整句话当标题（docs/07 §4.2 精简规则）。
 *
 * 支持的时长写法：
 *   一个半小时 / 1个半小时 → 90     半小时 / 半个小时 → 30
 *   两个小时 / 两小时 / 2小时 → 120  90分钟 / 45 分钟 → 45
 * 修饰词（至少 / 大概 / 大约 / 差不多 / 起码 / 左右）一并去除 ——
 * 预估本身就是估计值，精度留在标题里只会碍事。
 *
 * 纯函数，entities 层；被 features/daily-plan 的写入单点调用。
 */

const CN_NUM: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function numOf(token: string): number {
  return CN_NUM[token] ?? Number(token);
}

export interface TitleWithDuration {
  title: string;
  estimateMinutes: number | undefined;
}

/** 提取失败时原样返回（title = 原文，estimateMinutes = undefined） */
export function extractDuration(raw: string): TitleWithDuration {
  const text = raw.trim();
  if (text.length === 0) return { title: raw, estimateMinutes: undefined };

  // 顺序敏感：带"半"的复合式必须先于整小时匹配
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => number]> = [
    [
      /([一两二三四五六七八九十]|\d+(?:\.\d+)?)\s*个?\s*半\s*个?\s*小时/,
      (m) => (numOf(m[1]!) + 0.5) * 60,
    ],
    [/半\s*个?\s*小时/, () => 30],
    [
      /([一两二三四五六七八九十]|\d+(?:\.\d+)?)\s*个?\s*小时/,
      (m) => numOf(m[1]!) * 60,
    ],
    [/(\d+)\s*分钟/, (m) => Number(m[1])],
  ];

  let minutes: number | undefined;
  let title = text;
  for (const [pattern, calc] of patterns) {
    const match = text.match(pattern);
    if (match === null) continue;
    minutes = Math.round(calc(match));
    title = text.replace(match[0], "");
    break;
  }

  if (minutes === undefined) return { title: text, estimateMinutes: undefined };

  // 清理残渣：修饰词、孤立的冒号与首尾空白
  title = title
    .replace(/(?:至少|大概|大约|差不多|起码|左右)/g, "")
    .replace(/[：:]\s*$/, "")
    .replace(/^[：:]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 极端情况：整句话就是时长（如"一个小时"）—— 保留原文当标题，别交白卷
  if (title.length === 0) return { title: text, estimateMinutes: minutes };

  return { title, estimateMinutes: minutes };
}
