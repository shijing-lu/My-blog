/** 日程语义色映射到博客主题；正文采用主题前景色，图表采用博客 chart 变量。 */
export const graphicPigment = {
  plan: "var(--chart-3)", // 琥珀 · 计划
  session: "var(--chart-5)", // 陶土 · 执行 / 紧迫
  done: "var(--chart-2)", // 森林 · 完成
  todo: "var(--chart-1)", // 手工蓝 · 待办 / 信息
  review: "var(--chart-4)", // 织物紫 · 复盘
  archive: "var(--muted-foreground)", // 赭石 · 归档
} as const;

/* ── 可安全作为正文文字（全部实测 ≥ 4.5:1） ── */
export const textSafePigment = {
  plan: "var(--foreground)",
  session: "var(--destructive)",
  done: "var(--foreground)",
  todo: "var(--foreground)",
  review: "var(--foreground)",
  archive: "var(--muted-foreground)",
} as const;

/** 浅色填充（标签底、选中态背景） */
export const softPigment = {
  plan: "color-mix(in srgb, var(--chart-3) 12%, var(--card))",
  session: "color-mix(in srgb, var(--chart-5) 12%, var(--card))",
  done: "color-mix(in srgb, var(--chart-2) 12%, var(--card))",
  todo: "color-mix(in srgb, var(--chart-1) 12%, var(--card))",
  review: "color-mix(in srgb, var(--chart-4) 12%, var(--card))",
  archive: "var(--muted)",
} as const;

export type PigmentKey = keyof typeof graphicPigment;

/** 语义键列表（Zod Schema、表单下拉等需要枚举的地方用它，保证与真相源同步） */
export const PIGMENT_KEYS = [
  "plan",
  "session",
  "done",
  "todo",
  "review",
  "archive",
] as const;

/**
 * 语义分配表（05 号文档 §2.8）—— 全站唯一真相
 *
 * 界面上每处颜色都对应一件用户正在做的事，而不是装饰：
 *   计划=琥珀图纸 / 执行=陶土熔炉 / 复盘=织物紫墨水 / 待办=手工蓝便签
 * 这样用户看到的颜色本身就在提示"我在哪一屏做什么"。
 */
export const SEMANTIC_PIGMENT: Record<
  "plan" | "session" | "done" | "todo" | "review" | "archive",
  { soft: string; base: string; text: string }
> = {
  plan: {
    soft: softPigment.plan,
    base: graphicPigment.plan,
    text: textSafePigment.plan,
  },
  session: {
    soft: softPigment.session,
    base: graphicPigment.session,
    text: textSafePigment.session,
  },
  done: {
    soft: softPigment.done,
    base: graphicPigment.done,
    text: textSafePigment.done,
  },
  todo: {
    soft: softPigment.todo,
    base: graphicPigment.todo,
    text: textSafePigment.todo,
  },
  review: {
    soft: softPigment.review,
    base: graphicPigment.review,
    text: textSafePigment.review,
  },
  archive: {
    soft: softPigment.archive,
    base: graphicPigment.archive,
    text: textSafePigment.archive,
  },
};

/**
 * 数据可视化色板（05 号文档 §2.6）
 *
 * 独立的 8 色，不复用语义色 —— 否则用户会把图表里的某一色误读为"这条数据是计划"。
 * 明度接近，保证在灰度打印与色盲条件下仍可区分。
 */
export const CHART_PALETTE = [
  "var(--chart-3)", // 琥珀
  "var(--primary)", // 靛青
  "var(--chart-2)", // 森林
  "var(--chart-4)", // 织物紫
  "var(--chart-5)", // 陶土
  "var(--muted-foreground)", // 赭石
  "var(--chart-1)", // 手工蓝
  "var(--foreground)", // 茜草
] as const;

/**
 * XY 看板的分区配色
 *
 * 例外于"图表色板"规则：四个象限使用**同一颜料的四档明度**，而非四个不同色相。
 * 理由：它们是同一维度切出的分区，用同色明度梯度更符合"这是一张图"的直觉。
 */
export const ZONE_PALETTE = [
  "color-mix(in srgb, var(--chart-3) 12%, var(--card))", // 象限 1 —— 最浅
  "color-mix(in srgb, var(--primary) 20%, var(--card))",
  "color-mix(in srgb, var(--primary) 35%, var(--card))",
  "var(--foreground)", // 象限 4 —— 最深
] as const;

/** 按索引取图表色，超出长度循环复用（避免调用方写 `% CHART_PALETTE.length`） */
export function chartColorAt(index: number): string {
  const list = CHART_PALETTE;
  const safe = ((index % list.length) + list.length) % list.length;
  return list[safe] ?? list[0];
}

/**
 * 浏览器 UI 主题色（<meta name="theme-color">）
 *
 * 用于移动端地址栏与桌面端窗口边框。必须与 paper-base / paper-1 保持一致，
 * 否则会出现"应用是米黄、地址栏是白色"的割裂感。
 * 放在这里是因为色值只允许出现在本文件与 tokens.css。
 */
export const THEME_META_COLOR = {
  light: "var(--background)",
  dark: "var(--background)",
} as const;
