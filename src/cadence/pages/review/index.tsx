/**
 * 复盘页（M5）
 * ---------------------------------------------------------------------------
 * 结构：选一天 → 每个启用的周期配置派生当天的格子 → 格子上写复盘。
 * 格子是派生物（deriveSlots），改周期配置立即以新解释呈现，零迁移。
 *
 * 与格子归属的设计对齐（entities/review/slot.ts）：
 * 当天列表包含所有与这一天相交的格子 —— 跨夜格子（昨日 17:00 起、
 * 覆盖今天 0–1 点）会出现在今天的第一格。归属按格子起点算，
 * 因此同一条复盘只属于一天，不会重复出现。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";

import type {
  ReviewEntry,
  ReviewSchedule,
  Slot,
} from "@/cadence/entities/review";
import { deriveSlots } from "@/cadence/entities/review";
import { db } from "@/cadence/data/db/database";
import {
  addDays,
  clockOf,
  dateKeyOf,
  localTzOffsetMinutes,
} from "@/cadence/shared/db/time";
import { AnimatePresence, Collapsible, m } from "@/cadence/shared/motion";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { Card } from "@/cadence/shared/ui/Card";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import { Tag } from "@/cadence/shared/ui/Tag";
import { TextField } from "@/cadence/shared/ui/TextField";
import {
  createReviewDeps,
  createSchedule,
  deleteEntry,
  EntryEditor,
  upsertEntry,
  type EditingTarget,
} from "@/cadence/features/review";

const MOOD_FACES = ["😖", "😕", "😐", "🙂", "😄"] as const;
/** 已填格数超过这个值时，格子网格默认折叠（每小时一记的一天有 24 条） */
const COLLAPSE_THRESHOLD = 8;

export function ReviewPage() {
  const deps = useMemo(() => createReviewDeps(db), []);
  const [tz] = useState(() => localTzOffsetMinutes());

  const [selectedKey, setSelectedKey] = useState(() =>
    dateKeyOf(Date.now(), localTzOffsetMinutes()),
  );
  const [editing, setEditing] = useState<EditingTarget | undefined>(undefined);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const liveSchedules = useLiveQuery(() => deps.schedules.list(), [deps]);
  const schedules = useMemo(() => liveSchedules ?? [], [liveSchedules]);
  const liveEntries = useLiveQuery(() => deps.entries.list(), [deps]);
  const entries = useMemo(() => liveEntries ?? [], [liveEntries]);

  /** 复盘条目按 [scheduleId@slotStart] 索引，格子渲染 O(1) 命中 */
  const entryOf = useMemo(() => {
    const map = new Map<string, ReviewEntry>();
    for (const entry of entries)
      map.set(`${entry.scheduleId}@${entry.slotStart}`, entry);
    return map;
  }, [entries]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Review"
        title="复盘"
        rule="gentle"
        description="按周期回看一天。修改周期会重新生成格子，原有内容仍保存在历史记录里。"
      />

      {/* 日期切换 */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedKey(addDays(selectedKey, -1, tz))}
        >
          ← 前一天
        </Button>
        <div className="text-center">
          <p className="text-ink-1 font-serif text-[17px]">{selectedKey}</p>
          <button
            type="button"
            onClick={() => setSelectedKey(dateKeyOf(Date.now(), tz))}
            className="text-ink-4 hover:text-ink-2 craft-transition-fast text-[11px]"
          >
            回到今天
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedKey(addDays(selectedKey, 1, tz))}
        >
          后一天 →
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card className="text-center">
          <p className="text-ink-2 py-4 text-[13.5px]">
            还没有复盘周期。从「每 8 小时问一次」开始，观察自己的节奏：
          </p>
          <Button size="sm" onClick={() => setShowCreateSchedule(true)}>
            新建复盘周期
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          {schedules
            .filter((schedule) => schedule.enabled)
            .map((schedule) => (
              <ScheduleSection
                key={schedule.id}
                schedule={schedule}
                dateKey={selectedKey}
                tz={tz}
                entryOf={entryOf}
                onEdit={(slot, entry) =>
                  setEditing(
                    entry !== undefined
                      ? { schedule, slot, entry }
                      : { schedule, slot },
                  )
                }
              />
            ))}
        </div>
      )}

      {schedules.length > 0 ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowCreateSchedule(true)}
            className="text-ink-4 hover:text-ink-2 craft-transition-fast text-[12px]"
          >
            + 再建一个周期
          </button>
        </div>
      ) : null}

      <AnimatePresence>
        {showCreateSchedule ? (
          <CreateScheduleCard
            onCancel={() => setShowCreateSchedule(false)}
            onCreate={async (draft) => {
              await createSchedule(deps, draft, Date.now());
              setShowCreateSchedule(false);
              toast.success("周期已创建");
            }}
          />
        ) : null}
      </AnimatePresence>

      <Card>
        <details>
          <summary className="cursor-pointer text-sm">
            {selectedKey} 的已保存复盘（含旧周期记录）
          </summary>
          <div className="mt-4 space-y-4">
            {entries
              .filter((entry) => entry.dateKey === selectedKey)
              .map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-md border border-border p-4"
                >
                  <p className="text-xs text-muted-foreground">
                    {schedules.find((s) => s.id === entry.scheduleId)?.title ??
                      "已删除的周期"}{" "}
                    · {clockOf(entry.slotStart, tz)}
                    {entry.mood ? ` · 心情 ${entry.mood}/5` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {entry.content}
                  </p>
                </article>
              ))}
            {!entries.some((entry) => entry.dateKey === selectedKey) && (
              <p className="text-sm text-muted-foreground">
                这一天还没有保存复盘。
              </p>
            )}
          </div>
        </details>
      </Card>
      <EntryEditor
        target={editing}
        onClose={() => setEditing(undefined)}
        onSave={async (schedule, slot, draft, entryId) => {
          await upsertEntry(
            deps,
            schedule,
            slot.start,
            slot.dateKey,
            draft,
            Date.now(),
          );
          setEditing(undefined);
          toast.success(entryId !== undefined ? "已更新" : "已记下");
        }}
        onDelete={async (entryId) => {
          await deleteEntry(deps, entryId, Date.now());
          setEditing(undefined);
          toast.info("已删除，30 天内可在回收站恢复");
        }}
      />
    </div>
  );
}

/* ── 子组件 ── */

/** 单个周期的当天格子网格（已填较多时默认折叠，避免长列表刷屏） */
function ScheduleSection({
  schedule,
  dateKey,
  tz,
  entryOf,
  onEdit,
}: {
  schedule: ReviewSchedule;
  dateKey: string;
  tz: number;
  entryOf: Map<string, ReviewEntry>;
  onEdit: (slot: Slot, entry?: ReviewEntry) => void;
}) {
  const slots = useMemo(
    () => deriveSlots(schedule, dateKey, tz),
    [schedule, dateKey, tz],
  );
  const filled = useMemo(
    () =>
      slots.filter((slot) => entryOf.has(`${schedule.id}@${slot.start}`))
        .length,
    [slots, schedule.id, entryOf],
  );
  const [open, setOpen] = useState(filled <= COLLAPSE_THRESHOLD);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ink-1 font-serif text-[15px]">{schedule.title}</h3>
        <Tag tone="plan">
          {schedule.intervalHours} 小时 · 已填 {filled} / {slots.length}
        </Tag>
      </div>
      {schedule.prompt !== undefined ? (
        <p className="text-ink-3 mt-1.5 text-[12px]">「{schedule.prompt}」</p>
      ) : null}

      <Collapsible
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            className="text-ink-4 hover:text-ink-2 craft-transition-fast mt-3 inline-block cursor-pointer text-[11.5px]"
          >
            {open ? "收起格子" : `展开 ${slots.length} 个格子`}
          </button>
        }
      >
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot) => {
            const entry = entryOf.get(`${schedule.id}@${slot.start}`);
            return (
              <button
                key={slot.start}
                type="button"
                onClick={() => onEdit(slot, entry)}
                className={[
                  "craft-transition-fast surface-inset min-h-[76px] rounded-[var(--radius-hand-sm)] p-3 text-left",
                  entry
                    ? "hover:shadow-[0_2px_6px_-3px_var(--paper-shadow-strong)]"
                    : "",
                ].join(" ")}
                style={
                  entry
                    ? undefined
                    : { boxShadow: "inset 0 0 0 1.5px var(--color-paper-line)" }
                }
              >
                <p className="text-ink-4 numeric text-[10.5px]">
                  {clockOf(slot.start, tz)} – {clockOf(slot.end, tz)}
                </p>
                {entry ? (
                  <>
                    <p className="text-ink-1 mt-1 line-clamp-2 text-[12.5px]">
                      {entry.content}
                    </p>
                    {entry.mood !== undefined ? (
                      <span
                        aria-label={`心情 ${entry.mood} / 5`}
                        className="text-[13px]"
                      >
                        {MOOD_FACES[entry.mood - 1]}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <p className="text-ink-4 mt-1 text-[12px]">+ 记一笔</p>
                )}
              </button>
            );
          })}
        </div>
      </Collapsible>
    </Card>
  );
}

/** 新建周期：标题 + 间隔 + 锚点时刻 + 引导语 */
function CreateScheduleCard({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: {
    title: string;
    intervalHours: number;
    anchorOffsetMs: number;
    prompt?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [intervalHours, setIntervalHours] = useState(8);
  const [anchorClock, setAnchorClock] = useState("09:00");
  const [prompt, setPrompt] = useState("");

  const anchorOffsetMs = useMemo(() => {
    const [h = 0, m = 0] = anchorClock.split(":").map(Number);
    return ((((h * 60 + m) % 1440) + 1440) % 1440) * 60_000;
  }, [anchorClock]);

  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ink-1 font-serif text-[15px]">新建复盘周期</h3>
          <span className="text-ink-4 text-[11.5px]">
            改配置零成本，随时可调
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="周期名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：三时省"
          />
          <TextField
            label="引导语"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="如：这三小时推进了什么？"
          />
          <label className="text-ink-2 block text-[12.5px]">
            间隔
            <select
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value))}
              className="text-ink-1 surface-inset mt-1 block w-full rounded-[var(--radius-hand-sm)] px-3 py-2 text-[13px]"
            >
              {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                <option key={h} value={h}>
                  每 {h} 小时
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="锚点时刻（第一格起点）"
            value={anchorClock}
            onChange={(e) => setAnchorClock(e.target.value)}
            placeholder="09:00"
            type="time"
          />
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void onCreate({
                title,
                intervalHours,
                anchorOffsetMs,
                prompt,
              }).catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : "创建失败",
                ),
              );
            }}
          >
            创建
          </Button>
        </div>
      </Card>
    </m.div>
  );
}
