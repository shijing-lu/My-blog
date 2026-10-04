/**
 * 可拖拽平面（L3 模式层）
 * ---------------------------------------------------------------------------
 * 这是整个产品**性能最敏感**的组件（XY 看板的核心）。
 *
 * 三条硬性设计（对应性能红线 R3 / NFR-PERF-07）：
 *
 * 1. 拖拽过程中**不更新 React state、不写数据库**
 *    位置由 MotionValue 直接写入 DOM 的 transform。整场拖拽下来，
 *    React 的重渲染次数是 0。若把坐标放进 state，60fps 拖 2 秒
 *    就是 120 次重渲染 —— 一次拖拽就能把低端设备拖垮。
 *
 * 2. **只在松手时提交一次**
 *    由 useDragCommit 完成，并区分"点击"与"拖拽"：位移不足阈值视为点击，
 *    不提交坐标（否则手抖会静默挪走数据 —— 这是最难被发现的 bug 类型）。
 *
 * 3. `dragMomentum={false}`
 *    工具类产品的拖拽必须精确，不能有惯性漂移。惯性适合"甩卡片"这类
 *    内容型交互，不适合"把一个待办放进某个象限"。
 *
 * 坐标系：内部用像素偏移，提交时换算为归一化 0–100（**y 轴向上为正**，
 * 对应"重要性越高越靠上"）。
 *
 * ⚠️ 调用方契约：`onCommit` 之后必须同步更新传入的 `value`。
 *    组件在提交时把内部偏移归零，如果父级没有更新坐标，元素会弹回原位。
 */

import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

import { tiltOf } from "@/cadence/shared/lib/tilt";
import {
  m,
  rotation,
  spring,
  toNormalizedPoint,
  useDragCommit,
  useMotionValue,
  useResolvedMotion,
} from "@/cadence/shared/motion";

interface DraggableSurfaceProps {
  /** 实体 id：用于派生的稳定倾斜角 */
  id: string;
  /** 归一化位置（0–100，y 轴向上为正） */
  value: { x: number; y: number };
  /** 松手时提交一次；坐标已 clamp 到 0–100 */
  onCommit: (point: { x: number; y: number }) => void;
  /**
   * 拖拽容器：把视图坐标换算成归一化坐标的基准。
   * 必填 —— 没有它就无法把指针位置翻译成业务坐标。
   * （早期版本留过"没有容器就用假 rect 顶替"的分支，那会产生完全错误的坐标，
   *   比直接报错更危险，已移除。）
   */
  containerRef: RefObject<HTMLElement | null>;
  /** 倾斜角上限；看板场景应传 rotation.board */
  maxTilt?: number;
  /** 吸附步长（如 10 表示吸附到 10% 网格）；不传则不吸附 */
  snapStep?: number;
  /** 位移阈值（px）：低于此值视为点击，不提交 */
  threshold?: number;
  /** 点击（非拖拽）时回调；可与拖拽共存于同一个元素 */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function DraggableSurface({
  id,
  value,
  onCommit,
  containerRef,
  maxTilt = rotation.board,
  snapStep,
  threshold = 4,
  onClick,
  className,
  children,
}: DraggableSurfaceProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const zIndex = useMotionValue(0);

  const settle = useResolvedMotion(spring.settle);

  // 外部值变化时（撤销、批量移动、服务端回填）同步归零
  useEffect(() => {
    x.set(0);
    y.set(0);
  }, [value.x, value.y, x, y]);

  // 用 ref 持有最新回调，避免每次渲染重建 commit 链
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const valueRef = useRef(value);
  valueRef.current = value;

  const handleCommit = useCallback(
    (point: { clientX: number; clientY: number }) => {
      const container = containerRef.current;
      if (!container) return;

      let next = toNormalizedPoint(point, container.getBoundingClientRect());

      if (snapStep) {
        next = {
          x: Math.round(next.x / snapStep) * snapStep,
          y: Math.round(next.y / snapStep) * snapStep,
        };
      }

      // 归零内部偏移：父级更新 value 后，元素在新位置上的视觉是连续的
      x.set(0);
      y.set(0);

      onCommitRef.current(next);
    },
    [containerRef, snapStep, x, y],
  );

  const drag = useDragCommit({ onCommit: handleCommit, threshold });

  const handleClick = useCallback(() => {
    // 拖拽尾随的 click 必须忽略，否则"拖完顺手点一下"会误触发进入详情
    if (drag.wasDragged()) return;
    onClick?.();
  }, [drag, onClick]);

  return (
    <m.div
      drag
      dragMomentum={false}
      dragElastic={0.06}
      style={{
        x,
        y,
        zIndex,
        rotate: tiltOf(id, maxTilt),
        willChange: "transform",
      }}
      whileDrag={{
        scale: 1.06,
        rotate: 0, // 拿起来了，贴在纸上的倾斜角随之归零
        boxShadow:
          "inset 0 1px 0 0 rgb(255 255 255 / 55%), 0 3px 6px -2px var(--paper-shadow), 0 14px 26px -12px var(--paper-shadow)",
      }}
      transition={settle}
      onDragStart={(event, info) => {
        zIndex.set(40);
        drag.onDragStart(event, info);
      }}
      onDrag={(event, info) => {
        drag.onDrag(event, info);
      }}
      onDragEnd={(event, info) => {
        zIndex.set(0);
        drag.onDragEnd(event, info);
      }}
      onClick={handleClick}
      className={[
        "cursor-grab touch-none select-none active:cursor-grabbing",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </m.div>
  );
}
