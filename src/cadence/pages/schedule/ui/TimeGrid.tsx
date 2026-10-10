/**
 * 24 小时时间网格（docs/08-日程面板.md）
 * ---------------------------------------------------------------------------
 * 交互规范（业界调研结论的落地，docs/08 §2）：
 *   - 双击空白 → 以吸附后的时刻为起点回调新建
 *   - 拖事件主体 = 平移（时长不变），拖底缘 = 调时长；1 分钟吸附
 *   - 拖拽中渲染 ghost + 浮动 HH:MM–HH:MM 提示；松手才提交，失败自然回弹
 *     （useLiveQuery 未变 = 数据未变 = 块回到原位，"回弹"不需要专门代码）
 *   - 点击（位移 < 4px）= 打开详情；拖拽与点击共存
 */

import {
  useRef,
  useState,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { ScheduleEvent } from "@/cadence/entities/schedule";
import { snapDown } from "@/cadence/entities/schedule";
import { pigmentClasses } from "@/cadence/shared/ui/pigment-classes";
import { eventLayout } from "./event-layout";

/**
 * 每分钟对应的像素高度。
 * 导出是因为页面层需要用它算"初始滚动到当前时刻"的位置 ——
 * 让刻度尺寸只有一个真相来源，避免两处各写一个 1.1 而慢慢漂开。
 */
export const TIME_GRID_PX_PER_MIN = 1.1;
const PX_PER_MIN = TIME_GRID_PX_PER_MIN;
const GUTTER = 56;
const DRAG_THRESHOLD_PX = 4;

const HOURS = Array.from({ length: 24 }, (_, index) => index);

export interface DragPreview {
  id: string;
  startMin: number;
  endMin: number;
}

interface TimeGridProps {
  events: readonly ScheduleEvent[];
  /** 当天分钟数（仅查看当天时显示 now-line），非当天传 undefined */
  nowMin: number | undefined;
  /** 拖拽移动提交（抛错 = 拒绝落点，块回弹） */
  onMove: (id: string, newStartMin: number) => void;
  onResize: (id: string, newEndMin: number) => void;
  onOpen: (event: ScheduleEvent) => void;
  onCreateAt: (startMin: number) => void;
}

export function TimeGrid({
  events,
  nowMin,
  onMove,
  onResize,
  onOpen,
  onCreateAt,
}: TimeGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | {
        mode: "move" | "resize";
        id: string;
        originY: number;
        origStart: number;
        origEnd: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const [preview, setPreview] = useState<DragPreview | undefined>(undefined);
  const positions = useMemo(() => eventLayout(events.map(item => preview?.id === item.id ? { ...item, ...preview } : item), PX_PER_MIN), [events, preview]);

  const previewEvent =
    preview !== undefined
      ? events.find((event) => event.id === preview.id)
      : undefined;

  const minutesFromY = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect === undefined) return 0;
    return (clientY - rect.top) / PX_PER_MIN;
  };

  const onPointerDown = (
    event: ReactPointerEvent,
    item: ScheduleEvent,
    mode: "move" | "resize",
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      id: item.id,
      originY: event.clientY,
      origStart: item.startMin,
      origEnd: item.endMin,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (drag === undefined) return;
    if (Math.abs(event.clientY - drag.originY) > DRAG_THRESHOLD_PX)
      drag.moved = true;

    const duration = drag.origEnd - drag.origStart;
    const delta = (event.clientY - drag.originY) / PX_PER_MIN;

    if (drag.mode === "move") {
      const start = Math.min(
        Math.max(snapDown(drag.origStart + delta), 0),
        24 * 60 - duration,
      );
      setPreview({ id: drag.id, startMin: start, endMin: start + duration });
    } else {
      const end = Math.min(
        Math.max(snapDown(drag.origEnd + delta), drag.origStart + 1),
        24 * 60,
      );
      setPreview({ id: drag.id, startMin: drag.origStart, endMin: end });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = undefined;
    const ghost = preview;
    setPreview(undefined);
    if (drag === undefined) return;

    if (!drag.moved || ghost === undefined) {
      if (drag.mode === "move") {
        // 位移过小 = 点击，打开详情
        const item = events.find((event) => event.id === drag.id);
        if (item !== undefined) onOpen(item);
      }
      return;
    }
    if (drag.mode === "move") onMove(drag.id, ghost.startMin);
    else onResize(drag.id, ghost.endMin);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    // 只响应网格空白处（事件块自己 stopPropagation）
    const min = snapDown(minutesFromY(event.clientY));
    onCreateAt(Math.min(Math.max(min, 0), 24 * 60 - 1));
  };

  return (
    <div className="flex" style={{ height: 24 * 60 * PX_PER_MIN + 2 }}>
      {/* 小时刻度 */}
      <div
        className="text-ink-4 numeric relative shrink-0"
        style={{ width: GUTTER }}
      >
        {HOURS.map((hour) => (
          <span
            key={hour}
            className="absolute right-2 text-[10.5px]"
            style={{ top: hour * 60 * PX_PER_MIN - 7 }}
          >
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>

      {/* 网格主体 */}
      <div
        ref={gridRef}
        data-testid="schedule-grid"
        role="grid"
        aria-label="24 小时日程面板"
        onDoubleClick={onDoubleClick}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="bg-paper-1/40 relative flex-1 cursor-copy select-none rounded-[var(--radius-hand-md)]"
        style={{ boxShadow: "inset 0 0 0 1.5px var(--color-paper-line)" }}
      >
        {/* 小时线 + 半点虚线 */}
        {HOURS.map((hour) => (
          <span
            key={hour}
            aria-hidden="true"
            className="bg-paper-line absolute inset-x-0 h-px"
            style={{ top: hour * 60 * PX_PER_MIN }}
          />
        ))}
        {HOURS.map((hour) =>
          hour < 23 ? (
            <span
              key={`half-${hour}`}
              aria-hidden="true"
              className="border-paper-line/60 absolute inset-x-0 border-t border-dashed"
              style={{ top: (hour * 60 + 30) * PX_PER_MIN }}
            />
          ) : null,
        )}

        {/* now-line */}
        {nowMin !== undefined ? (
          <span
            aria-hidden="true"
            data-testid="now-line"
            className="text-clay-deep absolute inset-x-0 z-[5] border-t-2 border-dashed"
            style={{ top: nowMin * PX_PER_MIN }}
          />
        ) : null}

        {/* 事件块 */}
        {events.map((item) => {
          const ghost =
            preview !== undefined && preview.id === item.id
              ? preview
              : undefined;
          const { top, height, lane, columns } = positions.get(item.id)!;
          const tone = pigmentClasses("session");
          return (
            <div
              key={item.id}
              role="gridcell"
              tabIndex={0}
              aria-label={`${item.title} ${clockOfMinutes(item.startMin)}–${clockOfMinutes(item.endMin)}`}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); } }}
              className={[
                "absolute z-[6] overflow-hidden rounded-[var(--radius-hand-sm)] px-2 py-1",
                ghost !== undefined
                  ? "opacity-70 shadow-[0_4px_14px_-6px_var(--paper-shadow-strong)]"
                  : "",
                item.done ? "opacity-60" : "",
              ].join(" ")}
              style={{
                top,
                height,
                left: `calc(${lane * 100 / columns}% + 6px)`,
                width: `calc(${100 / columns}% - 12px)`,
                background:
                  "var(--color-session-soft, var(--color-amber-soft))",
                boxShadow: `inset 0 0 0 1.5px var(--color-session-base, var(--color-amber-base))`,
              }}
            >
              <div
                onPointerDown={(event) => onPointerDown(event, item, "move")}
                className={[
                  "flex h-full cursor-grab flex-col",
                  "active:cursor-grabbing",
                ].join(" ")}
              >
                <span
                  className={[
                    "truncate text-[12px] leading-tight",
                    item.done ? "text-ink-4 line-through" : tone.text,
                  ].join(" ")}
                >
                  {item.title}
                </span>
                {height > 34 ? (
                  <span className="text-ink-4 numeric text-[10px]">
                    {clockOfMinutes(item.startMin)}–
                    {clockOfMinutes(item.endMin)}
                  </span>
                ) : null}
              </div>
              {/* 底缘调时长把手 */}
              <span
                onPointerDown={(event) => onPointerDown(event, item, "resize")}
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
              />
            </div>
          );
        })}

        {/* 拖拽浮动提示（HH:MM–HH:MM 跟随 ghost） */}
        {preview !== undefined && previewEvent !== undefined ? (
          <span
            data-testid="drag-tooltip"
            className="bg-ink-1 text-paper-base numeric absolute left-1/2 z-[8] -translate-x-1/2 rounded-full px-2.5 py-1 text-[10.5px]"
            style={{ top: Math.max(0, preview.startMin * PX_PER_MIN - 26) }}
          >
            {clockOfMinutes(preview.startMin)}–{clockOfMinutes(preview.endMin)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function clockOfMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
