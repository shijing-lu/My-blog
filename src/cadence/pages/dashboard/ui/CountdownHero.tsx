/**
 * 倒计时 hero（总览页顶部，docs/10-倒计时.md）
 * ---------------------------------------------------------------------------
 * 展示形式（用户验收点）：
 *   - 位置：总览页 PageHeader 之下、所有模块之前 —— 最显眼处
 *   - 形态：大字号"天"为主数字（考研这类长期目标看天），时/分/秒为辅；
 *     秒级跳动仅在"最近一条 < 1 天"或用户展开时驱动，避免全页每秒重渲染
 *   - 进度：底色进度条 = 已过时间占比（目标时刻与创建时刻之间），一眼看出走了多远
 *   - 调节：每条就地可调 —— +1 单位续时 / -1 单位减时 / 暂停·继续 / 重设 / 改名 / 删除
 *
 * 秒级跳动实现：单个 setInterval 驱动一个 nowMs 状态，仅在"存在运行中的倒计时"时启动，
 * 无倒计时或全部暂停时不启动定时器（省电、省渲染）。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";

import {
  breakdownOf,
  clockOfMs,
  dateKeyOfMs,
  describeAmount,
  formatRemainingIn,
  isPaused,
  primaryOf,
  remainingMsOf,
  targetAtOfDateTime,
  UNIT_LABEL,
  UNIT_MS,
  type Countdown,
  type CountdownUnit,
} from "@/cadence/entities/countdown";
import { db } from "@/cadence/data/db/database";
import { HandRule } from "@/cadence/shared/motion";
import { localTzOffsetMinutes } from "@/cadence/shared/db/time";
import { toast } from "@/cadence/shared/store/toast-store";
import { pigmentClasses } from "@/cadence/shared/ui/pigment-classes";
import { Button } from "@/cadence/shared/ui/Button";
import { SegmentedControl } from "@/cadence/shared/ui/SegmentedControl";
import { TextField } from "@/cadence/shared/ui/TextField";
import {
  adjustCountdown,
  createCountdown,
  createCountdownDeps,
  pauseCountdown,
  removeCountdown,
  renameCountdown,
  resetCountdown,
  resumeCountdown,
} from "@/cadence/features/countdown";

const UNITS: readonly CountdownUnit[] = ["minute", "hour", "day"];

export function CountdownHero() {
  const deps = useMemo(() => createCountdownDeps(db), []);
  const rows = useLiveQuery(() => deps.countdowns.list(), [deps]);
  const countdowns = useMemo(
    () =>
      (rows ?? [])
        .slice()
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [rows],
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasRunning = countdowns.some((item) => !isPaused(item));
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Countdown | undefined>(undefined);
  const [deleting, setDeleting] = useState<Countdown | undefined>(undefined);

  return (
    <section
      data-testid="countdown-hero"
      className="surface-card cadence-overview-card"
      aria-label="倒计时"
    >
      <div className="cadence-card-heading flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px]">倒计时</h3>
          <span className="text-ink-3 text-[11px]">
            {countdowns.length > 0
              ? `${countdowns.length} 个进行中`
              : "分钟 / 小时 / 天"}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          + 新建
        </Button>
      </div>
      <div className="cadence-card-scroll" tabIndex={0} role="region" aria-label="倒计时列表">
      {countdowns.length === 0 ? (
        <p className="text-ink-3 py-7 text-center text-[12.5px]">
          还没有倒计时。设置一个目标吧，比如「考研」——按天、按小时或按分钟都可以。
        </p>
      ) : (
        <div className="space-y-2">
          {countdowns.map((item) => (
            <CountdownCard
              key={item.id}
              countdown={item}
              now={nowMs}
              onAdjust={(steps) => {
                void adjustCountdown(deps, item, steps, Date.now()).catch(
                  (error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "调节失败",
                    ),
                );
              }}
              onTogglePause={() => {
                const action = isPaused(item)
                  ? resumeCountdown(deps, item, Date.now())
                  : pauseCountdown(deps, item, Date.now());
                void action.then(() =>
                  toast.info(isPaused(item) ? "已继续" : "已暂停"),
                );
              }}
              onRename={(name) => {
                void renameCountdown(deps, item, name, Date.now()).catch(
                  (error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "改名失败",
                    ),
                );
              }}
              onEdit={() => setEditing(item)}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </div>
      )}
      </div>

      {creating ? (
        <CountdownDialog
          title="新建倒计时"
          onClose={() => setCreating(false)}
          onSubmit={(draft) => {
            setCreating(false);
            void createCountdown(deps, draft, Date.now())
              .then((created) =>
                toast.success(`「${created.name}」已开始倒计时`),
              )
              .catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : "创建失败",
                ),
              );
          }}
        />
      ) : null}

      {editing !== undefined ? (
        <CountdownDialog
          title={`重设 · ${editing.name}`}
          initialName={editing.name}
          initialUnit={editing.unit}
          initialTargetAt={editing.targetAt}
          onClose={() => setEditing(undefined)}
          onSubmit={(draft) => {
            const target = editing;
            setEditing(undefined);
            void resetCountdown(deps, target, draft, Date.now()).catch(
              (error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : "重设失败",
                ),
            );
          }}
        />
      ) : null}

      {deleting !== undefined ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-[var(--scrim)]"
          onClick={() => setDeleting(undefined)}
        >
          <div
            className="surface-card w-[min(400px,92vw)] p-6"
            onClick={(event) => event.stopPropagation()}
            style={{ borderRadius: "var(--radius-hand-lg)" }}
          >
            <h3 className="text-ink-1 font-serif text-lg">删除倒计时？</h3>
            <p className="text-ink-3 mt-2 text-[12.5px]">
              「{deleting.name}」会被移除，可在设置页的回收站里恢复。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(undefined)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  const target = deleting;
                  setDeleting(undefined);
                  void removeCountdown(deps, target.id, Date.now()).then(() =>
                    toast.undoable(`已删除「${target.name}」`, () =>
                      toast.info("可在设置页回收站恢复"),
                    ),
                  );
                }}
              >
                删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 单条倒计时：大数字 + 进度 + 就地调节（改名 = 卡片内联编辑） */
function CountdownCard({
  countdown,
  now,
  onAdjust,
  onTogglePause,
  onRename,
  onEdit,
  onDelete,
}: {
  countdown: Countdown;
  now: number;
  onAdjust: (steps: number) => void;
  onTogglePause: () => void;
  onRename: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const remaining = remainingMsOf(countdown, now);
  const parts = breakdownOf(remaining);
  const paused = isPaused(countdown);
  const total = Math.max(1, countdown.targetAt - countdown.createdAt);
  const progress = Math.min(
    100,
    Math.max(0, ((total - remaining) / total) * 100),
  );
  const tone = pigmentClasses(countdown.color);
  const finished = remaining === 0;
  const tz = localTzOffsetMinutes();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(countdown.name);

  // 主数字按**用户设定的单位**显示（选分钟就以分钟为主，不再自动降档到"天"）
  const primary = primaryOf(remaining, countdown.unit);

  // 辅行：比主单位小一级的精度（天 → 时:分:秒；小时 → 分:秒；分钟 → 秒）
  const secondary =
    countdown.unit === "day"
      ? `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")}`
      : countdown.unit === "hour"
        ? `${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")}`
        : `${String(parts.seconds).padStart(2, "0")} 秒`;

  return (
    <article
      className="surface-inset relative min-w-0 overflow-hidden p-2.5"
      style={{ borderRadius: "var(--radius-hand-md)" }}
      data-testid={`countdown-${countdown.name}`}
    >
      {/* 进度条贴底：已过时间占比 */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1.5"
        style={{ background: "var(--color-paper-2)" }}
      />
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-1.5 transition-[width] duration-1000 ease-linear"
        style={{
          width: `${progress}%`,
          background: `var(${TONE_BAR[countdown.color] ?? "--color-paper-2"})`,
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              aria-label="倒计时名称"
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setRenaming(false);
                  if (nameDraft.trim().length > 0) onRename(nameDraft);
                }
                if (event.key === "Escape") setRenaming(false);
              }}
              className="text-ink-1 surface-card w-full px-2.5 py-1 font-serif text-[14px] outline-none"
              style={{ borderRadius: "var(--radius-hand-sm)" }}
            />
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                if (nameDraft.trim().length > 0) onRename(nameDraft);
              }}
              className="text-ink-2 shrink-0 text-[11.5px]"
            >
              保存
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={["h-2 w-2 shrink-0 rounded-full", tone.dot].join(" ")}
            />
            <h4 className="text-ink-1 truncate font-serif text-[15px]">
              {countdown.name}
            </h4>
          </div>
        )}
        <span className="text-ink-3 shrink-0 text-[11px]">
          {paused
            ? "已暂停"
            : finished
              ? "已结束"
              : `每 ${UNIT_LABEL[countdown.unit]}可调`}
        </span>
      </div>

      {finished ? (
        <p className="text-clay-deep mt-3 font-serif text-[30px] leading-none">
          已结束
        </p>
      ) : (
        <p className="text-ink-1 mt-2 flex flex-wrap items-baseline gap-1 font-serif leading-none">
          <span
            className="max-w-full break-all text-[30px] tabular-nums"
            data-testid="countdown-primary-value"
          >
            {primary.value}
          </span>
          <span
            className="text-ink-2 text-[14px]"
            data-testid="countdown-primary-unit"
          >
            {primary.unit}
          </span>
          <span className="text-ink-3 ml-2 text-[13px] tabular-nums">
            {secondary}
          </span>
        </p>
      )}

      <p className="text-ink-4 mt-1.5 text-[11px]">
        剩余 {formatRemainingIn(remaining, countdown.unit)}
      </p>
      <p className="text-ink-4 text-[11px]">
        目标 {dateKeyOfMs(countdown.targetAt, tz)}{" "}
        {clockOfMs(countdown.targetAt, tz)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <MiniButton
          label={`+1${UNIT_LABEL[countdown.unit]}`}
          onClick={() => onAdjust(1)}
        />
        <MiniButton
          label={`-1${UNIT_LABEL[countdown.unit]}`}
          onClick={() => onAdjust(-1)}
        />
        <MiniButton label={paused ? "继续" : "暂停"} onClick={onTogglePause} />
        <MiniButton label="重设" onClick={onEdit} />
        <MiniButton
          label="改名"
          onClick={() => {
            setNameDraft(countdown.name);
            setRenaming(true);
          }}
        />
        <MiniButton label="删除" danger onClick={onDelete} />
      </div>
    </article>
  );
}

/** 语义颜料键 → 进度条 CSS 变量（显式表，避免动态拼 --color-xxx） */
const TONE_BAR: Record<string, string> = {
  todo: "--color-clay-base",
  plan: "--color-amber-base",
  session: "--color-craft-base",
  review: "--color-fabric-base",
  archive: "--color-ochre-base",
  done: "--color-forest-base",
};

function MiniButton({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "craft-transition-fast rounded-[var(--radius-hand-pill)] px-2 py-1 text-[11px]",
        "surface-card",
        danger
          ? "text-clay-deep hover:bg-clay-soft"
          : "text-ink-2 hover:text-ink-1",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * 新建 / 重设共用的对话框 —— 两种设定方式（用户验收点）：
 *   1. 按日期：日历选目标日期 + 填当天的小时:分（"几号几点结束"）
 *   2. 按时长：从现在起 N 个 单位（分钟 / 小时 / 天）
 * 两条路都归一到同一个 targetAt，且**单位决定卡片主数字的精度**
 * （选分钟就按分钟显示，选小时就按小时显示）。
 */
function CountdownDialog({
  title,
  initialName = "",
  initialUnit = "day",
  initialTargetAt,
  onClose,
  onSubmit,
}: {
  title: string;
  initialName?: string;
  initialUnit?: CountdownUnit;
  /** 重设时传入当前目标时刻，作为日历模式的初值 */
  initialTargetAt?: number | undefined;
  onClose: () => void;
  onSubmit: (draft: {
    name: string;
    amount: number;
    unit: CountdownUnit;
    targetAt?: number | undefined;
  }) => void;
}) {
  const tz = localTzOffsetMinutes();
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<"date" | "duration">("duration");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<CountdownUnit>(initialUnit);
  // 日历模式：默认取"当前目标时刻"或"此刻 + 1 天"，并四舍五入到整分
  const [dateKey, setDateKey] = useState(() => {
    const base = initialTargetAt ?? Date.now() + 86_400_000;
    return dateKeyOfMs(base, tz);
  });
  const [clock, setClock] = useState(() => {
    const base = initialTargetAt ?? Date.now() + 86_400_000;
    return clockOfMs(base, tz);
  });

  const [hourText, minuteText] = splitClock(clock);
  const parsed = Number(amount);
  const targetAtOfDate = targetAtOfDateTime(dateKey, clock, tz);
  const durationValid = Number.isFinite(parsed) && parsed > 0;
  const dateValid = targetAtOfDate !== undefined && targetAtOfDate > Date.now();
  const valid =
    name.trim().length > 0 && (mode === "date" ? dateValid : durationValid);

  // 实时预览：距离现在还有多少（按用户选择的单位呈现）
  const previewMs =
    mode === "date"
      ? dateValid && targetAtOfDate !== undefined
        ? targetAtOfDate - Date.now()
        : 0
      : durationValid
        ? parsed * UNIT_MS[unit]
        : 0;
  const preview = primaryOf(previewMs, unit);

  /** 只允许数字，并限位到 0–23 / 0–59，避免出现 25 点这种非法钟点 */
  function setPart(next: "hour" | "minute", raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    const max = next === "hour" ? 23 : 59;
    const clamped = digits === "" ? "" : String(Math.min(max, Number(digits)));
    const h = next === "hour" ? clamped : hourText;
    const m = next === "minute" ? clamped : minuteText;
    setClock(`${h.padStart(2, "0")}:${m.padStart(2, "0")}`);
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-[var(--scrim)]"
      onClick={onClose}
      data-testid="countdown-dialog"
    >
      <div
        className="surface-card w-[min(460px,92vw)] p-6"
        onClick={(event) => event.stopPropagation()}
        style={{ borderRadius: "var(--radius-hand-lg)" }}
      >
        <h3 className="text-ink-1 font-serif text-lg">{title}</h3>
        <HandRule shape="gentle" className="my-3" />

        <TextField
          label="名称"
          value={name}
          placeholder="比如：考研"
          onChange={(event) => setName(event.target.value)}
        />

        {/* 设定方式：按日期 / 按时长 */}
        <div className="mt-1 mb-3">
          <SegmentedControl
            label="设定方式"
            value={mode}
            onChange={(next) => setMode(next)}
            options={[
              { value: "date", label: "按日期" },
              { value: "duration", label: "按时长" },
            ]}
          />
        </div>

        {mode === "date" ? (
          <div className="grid grid-cols-[1.3fr_auto] items-end gap-3">
            <TextField
              label="目标日期"
              type="date"
              value={dateKey}
              onChange={(event) => setDateKey(event.target.value)}
            />
            <div className="pb-3">
              <span className="text-ink-3 mb-1 block text-[11.5px] tracking-wide">
                结束时刻
              </span>
              <div className="flex items-center gap-1.5">
                <ClockInput
                  label="小时"
                  value={hourText ?? "00"}
                  onChange={(raw) => setPart("hour", raw)}
                />
                <span className="text-ink-3 text-[14px]">:</span>
                <ClockInput
                  label="分钟"
                  value={minuteText ?? "00"}
                  onChange={(raw) => setPart("minute", raw)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <TextField
              label="时长"
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <div className="pb-3" role="group" aria-label="时间单位">
              {UNITS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={unit === item}
                  onClick={() => setUnit(item)}
                  className={[
                    "craft-transition-fast mr-1 rounded-[var(--radius-hand-pill)] px-3 py-1.5 text-[12px]",
                    unit === item
                      ? "bg-amber-soft text-amber-deep"
                      : "surface-inset text-ink-2",
                  ].join(" ")}
                >
                  {UNIT_LABEL[item]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 单位（两种模式共用）：决定卡片主数字按什么精度显示 */}
        {mode === "date" ? (
          <div className="mt-1" role="group" aria-label="显示单位">
            <span className="text-ink-3 mb-1 block text-[11.5px] tracking-wide">
              显示单位
            </span>
            {UNITS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={unit === item}
                onClick={() => setUnit(item)}
                className={[
                  "craft-transition-fast mr-1 rounded-[var(--radius-hand-pill)] px-3 py-1.5 text-[12px]",
                  unit === item
                    ? "bg-amber-soft text-amber-deep"
                    : "surface-inset text-ink-2",
                ].join(" ")}
              >
                {UNIT_LABEL[item]}
              </button>
            ))}
          </div>
        ) : null}

        <p
          className="text-ink-4 mt-2 text-[11px]"
          data-testid="countdown-dialog-preview"
        >
          {valid
            ? mode === "date"
              ? `距 ${dateKey} ${clock} 还有 ${preview.value} ${preview.unit}`
              : `从现在起 ${describeAmount(parsed, unit)}后结束（之后可随时续时或重设）`
            : mode === "date"
              ? "选一个晚于当前时刻的日期与时间"
              : "填一个大于 0 的时长"}
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() =>
              valid &&
              onSubmit(
                mode === "date"
                  ? { name, amount: 0, unit, targetAt: targetAtOfDate }
                  : { name, amount: parsed, unit },
              )
            }
          >
            开始
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 'HH:mm' → ['HH', 'mm']，缺失部分补 '00'（避免 noUncheckedIndexedAccess 下的 undefined） */
function splitClock(clock: string): [string, string] {
  const [h, m] = clock.split(":");
  return [h ?? "00", m ?? "00"];
}

/** 时/分输入：两位数、数字键盘、限位（手作风格与 TextField 一致：无边框 + 下划波浪） */
function ClockInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      data-testid={`countdown-clock-${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => event.target.select()}
      className={[
        "text-ink-1 surface-inset w-[52px] py-1.5 text-center text-[15px] tabular-nums outline-none",
        "focus-visible:ring-1 focus-visible:ring-[var(--color-amber-base)]",
      ].join(" ")}
      style={{ borderRadius: "var(--radius-hand-sm)" }}
    />
  );
}
