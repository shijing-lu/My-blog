/**
 * 专注统计面板 · 手绘 SVG 图表（docs/09）
 * ---------------------------------------------------------------------------
 * 不引入图表库的三个理由：
 *   1. 体积预算（NFR-PERF-05）：Recharts ≈ 90KB gzip，够装下整个 vendor-ui；
 *   2. 风格：匠人手账的"手作感"来自不完美——圆角笔触、纸张底色、
 *      手写体数字，通用图表库的"精确商务风"反而违和；
 *   3. 数据量级：个人专注统计 ≤ 千点，纯 SVG 绰绰有余。
 * 颜色全部走颜料 CSS 变量（红线 C5：色值只允许出现在 pigment.ts/tokens.css）。
 */

import type { DayFocus, ShareSlice } from "@/cadence/features/stats";

/** 图表色板（颜料 key → CSS 变量基色），循环取用 */
const PALETTE: readonly string[] = [
  "var(--color-amber-base)",
  "var(--color-forest-base)",
  "var(--color-craft-base)",
  "var(--color-fabric-base)",
  "var(--color-clay-base)",
  "var(--color-ochre-base)",
];

function shortDate(dateKey: string): string {
  const parts = dateKey.split("-");
  return `${parts[1]}/${parts[2]}`;
}

function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** 近 N 天专注趋势：柱状 + 均值虚线 */
export function FocusTrendChart({ days }: { days: readonly DayFocus[] }) {
  const width = 560;
  const height = 200;
  const pad = { top: 16, right: 12, bottom: 26, left: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(60, ...days.map((day) => day.minutes));
  const barW = innerW / days.length;
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  const mean = days.length > 0 ? total / days.length : 0;
  const meanY = pad.top + innerH * (1 - mean / max);

  return (
    <svg
      aria-label="近一段时间逐日专注分钟趋势图"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
    >
      {/* 均值参考线 */}
      {mean > 0 ? (
        <g>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={meanY}
            y2={meanY}
            stroke="var(--color-ink-3)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={width - pad.right}
            y={meanY - 4}
            textAnchor="end"
            fontSize={9}
            fill="var(--color-ink-3)"
          >
            日均 {hoursLabel(mean)}
          </text>
        </g>
      ) : null}

      {days.map((day, index) => {
        const h = (day.minutes / max) * innerH;
        const x = pad.left + index * barW + barW * 0.18;
        const w = barW * 0.64;
        const y = pad.top + innerH - h;
        const isToday = index === days.length - 1;
        return (
          <g key={day.dateKey}>
            <rect
              x={x}
              y={y}
              width={w}
              height={Math.max(h, day.minutes > 0 ? 2 : 0)}
              rx={3}
              fill={
                isToday ? "var(--color-amber-base)" : "var(--color-amber-soft)"
              }
              stroke={
                isToday ? "var(--color-amber-deep)" : "var(--color-amber-base)"
              }
              strokeWidth={1}
            />
            {day.minutes > 0 && barW > 26 ? (
              <text
                x={x + w / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize={8.5}
                fill="var(--color-ink-3)"
              >
                {hoursLabel(day.minutes)}
              </text>
            ) : null}
            <text
              x={x + w / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={9}
              fill={isToday ? "var(--color-ink-1)" : "var(--color-ink-3)"}
            >
              {shortDate(day.dateKey)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 时间占比：甜甜圈（中心显示总时长），图例并列 */
export function DonutChart({ slices }: { slices: readonly ShareSlice[] }) {
  const size = 168;
  const r = 62;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 22;
  const total = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.slice(0, 6).map((slice, index) => {
    const fraction = total > 0 ? slice.minutes / total : 0;
    const dash = fraction * circumference;
    const arc = {
      slice,
      dash,
      gap: circumference - dash,
      offset,
      color: PALETTE[index % PALETTE.length]!,
    };
    offset += dash;
    return arc;
  });
  const others = slices.slice(6).reduce((sum, slice) => sum + slice.minutes, 0);
  if (others > 0) {
    const fraction = total > 0 ? others / total : 0;
    arcs.push({
      slice: { label: "其他", minutes: others },
      dash: fraction * circumference,
      gap: circumference - fraction * circumference,
      offset,
      color: "var(--color-paper-line)",
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        aria-label="各计划专注时间占比环形图"
        role="img"
        viewBox={`0 0 ${size} ${size}`}
        className="h-[168px] w-[168px] shrink-0"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-paper-2)"
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.slice.label}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(arc.dash - 2, 0)} ${arc.gap + 2}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        ))}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize={17}
          fill="var(--color-ink-1)"
          className="font-serif"
        >
          {hoursLabel(total)}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize={9.5}
          fill="var(--color-ink-3)"
        >
          全部投入
        </text>
      </svg>

      <ul className="min-w-[150px] flex-1 space-y-1.5">
        {arcs.map((arc) => {
          const percent =
            total > 0 ? Math.round((arc.slice.minutes / total) * 100) : 0;
          return (
            <li
              key={arc.slice.label}
              className="flex items-center gap-2 text-[12px]"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: arc.color }}
              />
              <span className="text-ink-2 flex-1 truncate">
                {arc.slice.label}
              </span>
              <span className="text-ink-3 numeric">{percent}%</span>
            </li>
          );
        })}
        {arcs.length === 0 ? (
          <li className="text-ink-3 text-[12.5px]">还没有专注记录</li>
        ) : null}
      </ul>
    </div>
  );
}

/** 高效时段：0–23 点细柱，峰值高亮 */
export function HourBars({ bins }: { bins: readonly number[] }) {
  const width = 560;
  const height = 120;
  const pad = { top: 14, right: 8, bottom: 18, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(30, ...bins);
  const peak = bins.indexOf(Math.max(...bins));
  const barW = innerW / 24;

  return (
    <svg
      aria-label="一天 24 小时的专注时段分布图"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
    >
      {bins.map((minutes, hour) => {
        const h = (minutes / max) * innerH;
        const x = pad.left + hour * barW + barW * 0.2;
        const w = barW * 0.6;
        const isPeak = hour === peak && minutes > 0;
        return (
          <g key={hour}>
            <rect
              x={x}
              y={pad.top + innerH - h}
              width={w}
              height={Math.max(h, minutes > 0 ? 2 : 0)}
              rx={2}
              fill={
                isPeak ? "var(--color-forest-base)" : "var(--color-forest-soft)"
              }
            />
            {hour % 3 === 0 ? (
              <text
                x={x + w / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize={8.5}
                fill="var(--color-ink-3)"
              >
                {hour}
              </text>
            ) : null}
          </g>
        );
      })}
      {bins[peak]! > 0 ? (
        <text
          x={pad.left + peak * barW + barW / 2}
          y={pad.top + innerH - (bins[peak]! / max) * innerH - 4}
          textAnchor="middle"
          fontSize={9}
          fill="var(--color-forest-deep)"
        >
          {peak} 点 · {hoursLabel(bins[peak]!)}
        </text>
      ) : null}
    </svg>
  );
}

/** Top N 聚合：水平条形。showCount 用于"按名称聚合"卡片显示段数 */
export function HBarList({
  items,
  showCount = false,
  emptyText = "还没有挂到任务上的专注。执行页开始专注时选择任务，就能在这里看到时间去向。",
}: {
  items: readonly (ShareSlice & { count?: number })[];
  showCount?: boolean;
  emptyText?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.minutes));
  if (items.length === 0) {
    return <p className="text-ink-3 text-[12.5px]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-ink-1 truncate text-[12.5px]">
              {item.label}
            </span>
            <span className="text-ink-3 numeric text-[11.5px]">
              {hoursLabel(item.minutes)}
              {showCount && item.count !== undefined
                ? ` · ${item.count} 段`
                : ""}
            </span>
          </div>
          <div className="surface-inset h-2.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((item.minutes / max) * 100, 3)}%`,
                background: PALETTE[index % PALETTE.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
