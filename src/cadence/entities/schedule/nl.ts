/**
 * 自然语言 → 日程时间段（纯函数，确定性，不猜）
 * 依据：docs/08-日程面板.md §AI
 * ---------------------------------------------------------------------------
 * 用户说"6点到7点背单词，7点半到9点复习数学"，解析出两条日程。
 *
 * 算法（两步，均为确定性）：
 *   1. 全文扫描**完整时刻 token**（"9:00" / "6点" / "7点半" / "晚上八点"，含上午/下午标记），
 *      token 是自包含的——不会被标题里的文字"吸进去"。
 *   2. 相邻两个 token 之间若**只剩连接词**（到/至/~/-），配成一个时间段；
 *      孤儿时刻（没有配对对象）→ 整句解析失败并反问，绝不猜。
 *
 * 设计立场：
 *   - 时间词必须**显式出现**。没有时间词的句子不是日程创建，返回空让调用方反问，
 *     绝不默认"下一个空闲时段"。
 *   - 12/24 小时歧义：段内起点带"下午/晚上"且终点钟点 ≤ 12 时，终点 +12h
 *     （"下午3点到4点半" = 15:00–16:30）；无标记按字面 24 小时制。
 */

import { DAY_TOTAL_MIN, MIN_DURATION_MIN, snapDown } from "./model";

/** 解析出的一条候选日程（分钟制，未经重叠校验与 clamp） */
export interface NlScheduleItem {
  title: string;
  startMin: number;
  endMin: number;
}

export interface NlScheduleParseResult {
  items: NlScheduleItem[];
  /** 解析失败的原因（items 为空时给调用方组织反问话术） */
  error?: "no-time" | "unparsable-time" | "bad-order";
}

/* ── 中文数字（够用的子集） ── */

const CN_NUM: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function cnNumOf(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.length === 1) return CN_NUM[text];
  const m = text.match(
    /^(十|([一二两三四五六七八九])?十([一二三四五六七八九])?)$/,
  );
  if (m === null) return undefined;
  if (m[1] === "十") return 10;
  return CN_NUM[m[2]!]! * 10 + (m[3] === undefined ? 0 : CN_NUM[m[3]]!);
}

function minuteOfDay(hour: number, minute: number): number | undefined {
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return undefined;
  if (hour === 24 && minute !== 0) return undefined;
  return Math.min(hour * 60 + minute, DAY_TOTAL_MIN);
}

const PM_MARKER = /(?:下午|傍晚|晚上|夜里)/;

/**
 * 完整时刻 token：
 *   [时段标记]? + 钟点（阿拉伯或中文） + (:分钟 | 点+分钟/半/一刻/三刻)
 */
const CLOCK_TOKEN =
  /(上午|早上|清晨|凌晨|下午|傍晚|晚上|夜里)?\s*(\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?::\s*(\d{2})|点\s*(?:半|一刻|三刻|([一两二三四五六七八九十\d]{1,3})\s*分?)?)/g;

/** 两个时刻之间"只剩连接词"才算配对成功 */
const PURE_CONNECTOR = /^\s*(?:到|至|~|～|—|–|-)\s*$/;

interface ClockToken {
  minute: number;
  /** 是否带下午/晚上类标记（决定段内终点是否平移） */
  pm: boolean;
  /** 原始钟点（未平移），供段内歧义消解 */
  rawHour: number;
  from: number;
  to: number;
}

function scanClockTokens(text: string): ClockToken[] {
  const tokens: ClockToken[] = [];
  const re = new RegExp(CLOCK_TOKEN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const marker = match[1] ?? "";
    const hour = cnNumOf(match[2]!);
    if (hour === undefined) {
      re.lastIndex = match.index + 1;
      continue;
    }
    let minute = 0;
    if (match[3] !== undefined) {
      minute = Number(match[3]);
    } else if (match[4] !== undefined) {
      const parsed = cnNumOf(match[4]);
      if (parsed === undefined || parsed > 59) {
        re.lastIndex = match.index + 1;
        continue;
      }
      minute = parsed;
    } else if (match[0].includes("半")) {
      minute = 30;
    } else if (match[0].includes("三刻")) {
      minute = 45;
    } else if (match[0].includes("一刻")) {
      minute = 15;
    }

    // 标记平移：下午/晚上 + 钟点 ≤ 12（12 点本身是正午/午夜歧义，保持字面）
    let value = minuteOfDay(hour, minute);
    if (
      value !== undefined &&
      PM_MARKER.test(marker) &&
      hour <= 12 &&
      hour !== 12
    ) {
      value = minuteOfDay(hour + 12, minute);
    }
    if (value === undefined) {
      re.lastIndex = match.index + 1;
      continue;
    }

    tokens.push({
      minute: value,
      pm: PM_MARKER.test(marker),
      rawHour: hour,
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * 解析单个时刻表达（"8点半" / "14:30" / "晚上八点"）为当天分钟数。
 * 供日程移动/调长的 AI 工具使用：恰好一个时刻才成功，0 个或多个都返回 undefined。
 */
export function parseOneClock(text: string): number | undefined {
  const tokens = scanClockTokens(text.trim());
  if (tokens.length !== 1) return undefined;
  return tokens[0]!.minute;
}

/** 清理标题：去分隔符/空白/时段标记残渣；空串返回 undefined */
function cleanTitle(raw: string): string | undefined {
  const title = raw
    .replace(/(?:，|,|、|；|;|。|然后|接着|再)\s*/g, "")
    .replace(/(?:下午|傍晚|晚上|夜里|上午|早上|清晨|凌晨)/g, "")
    .trim();
  return title.length > 0 ? title : undefined;
}

/**
 * 解析一句话为多条日程。
 * 无时间词 → items 为空且 error='no-time'（调用方反问，绝不默认时段）。
 *
 * 标题归属（一段文字只归属一个时段，三种语序都支持）：
 *   "6点到7点背单词，7点半到9点复习数学"（时间在前）
 *   "背单词6点到7点，复习数学7点半到9点"（时间在后）
 *   "背单词 6点到7点 然后复习数学 7点半到9点"（混合）
 */
export function parseScheduleText(text: string): NlScheduleParseResult {
  const input = text.trim();
  if (input.length === 0) return { items: [], error: "no-time" };

  const tokens = scanClockTokens(input);
  if (tokens.length === 0) return { items: [], error: "no-time" };

  // 相邻 token 配对：之间只剩连接词才算一个时间段
  const spans: Array<{ start: ClockToken; end: ClockToken }> = [];
  let i = 0;
  while (i < tokens.length - 1) {
    const between = input.slice(tokens[i]!.to, tokens[i + 1]!.from);
    if (PURE_CONNECTOR.test(between)) {
      spans.push({ start: tokens[i]!, end: tokens[i + 1]! });
      i += 2;
    } else {
      // 当前 token 没有配对对象 → 有孤儿时刻，整句拒绝（绝不猜哪半截是时间）
      return { items: [], error: "unparsable-time" };
    }
  }
  if (i !== tokens.length) {
    // 最后一个 token 悬空（"…到9点，10点"）
    return { items: [], error: "unparsable-time" };
  }

  const items: NlScheduleItem[] = [];
  let cursor = 0;

  for (const span of spans) {
    const startMin = span.start.minute;
    let endMin = span.end.minute;

    // 段内 12 小时歧义：起点带下午/晚上标记、终点无标记且钟点 ≤ 12、
    // 且加 12h 后能形成合法顺序 → 终点平移（"下午3点到4点半" = 15:00–16:30）
    if (
      span.start.pm &&
      !span.end.pm &&
      span.end.rawHour <= 12 &&
      span.end.rawHour !== 12 &&
      endMin <= startMin &&
      minuteOfDay(span.end.rawHour + 12, Math.floor(endMin % 60)) !== undefined
    ) {
      const shifted = endMin + 12 * 60;
      if (shifted > startMin && shifted <= DAY_TOTAL_MIN) endMin = shifted;
    }

    if (endMin <= startMin) return { items: [], error: "bad-order" };
    if (endMin - startMin < MIN_DURATION_MIN)
      return { items: [], error: "unparsable-time" };

    const nextFrom = span.start.from;
    const before = cleanTitle(input.slice(cursor, nextFrom));
    if (before !== undefined) {
      items.push({ title: before, startMin: snapDown(startMin), endMin });
      cursor = span.end.to;
      continue;
    }

    // 时间在前：标题在本段结束到下一个时间段开始之间
    // （span.end.to 之后到下一个 span 的起点，即 cursor 的下一个消费区）
    const following = spans[spans.indexOf(span) + 1];
    const afterEnd =
      following === undefined ? input.length : following.start.from;
    const after = cleanTitle(input.slice(span.end.to, afterEnd));
    if (after === undefined) return { items: [], error: "unparsable-time" };
    items.push({ title: after, startMin: snapDown(startMin), endMin });
    cursor = afterEnd;
  }

  items.sort((a, b) => a.startMin - b.startMin);
  return { items };
}
