/**
 * 拖拽提交
 * 依据：docs/04-动画系统设计规格.md §4.3
 *
 * 解决的问题：拖拽组件上通常还绑着 onClick（点击进入详情）。
 * 如果直接松手就提交坐标，一次"想点开却手抖了 2px"的操作会被误判成拖拽，
 * 导致待办被悄悄挪走 —— 这类"静默数据变更"是最难被用户发现也最恼人的 bug。
 *
 * 因此本 Hook 区分三件事：
 *   1. 位移是否超过阈值（阈值以下视为点击）
 *   2. 拖拽过程中不提交（只在松手时提交一次）
 *   3. 提供 wasDragged() 给 onClick 判断，让点击处理器能主动忽略"拖拽尾随的 click"
 */

import type { PanInfo } from "motion/react";
import { useCallback, useMemo, useRef } from "react";

export interface DragCommitOptions {
  /** 松手时提交：坐标已换算为调用方需要的空间（如归一化 0–100） */
  onCommit: (point: DragCommitPoint) => void;
  /** 位移阈值（px）。低于此值视为点击，不触发提交 */
  threshold?: number;
}

export interface DragCommitPoint {
  /** 视图坐标（相对视口左上角） */
  clientX: number;
  clientY: number;
  /** 相对拖拽起点的位移 */
  offsetX: number;
  offsetY: number;
  /** 拖拽速度（px/s），可用于惯性判断 */
  velocityX: number;
  velocityY: number;
}

export interface DragCommitHandlers {
  onDragStart: (event: unknown, info: PanInfo) => void;
  onDrag: (event: unknown, info: PanInfo) => void;
  onDragEnd: (event: unknown, info: PanInfo) => void;
  /** onClick 里调用：返回 true 表示这次点击是拖拽的尾随事件，应当忽略 */
  wasDragged: () => boolean;
}

export function useDragCommit({
  onCommit,
  threshold = 4,
}: DragCommitOptions): DragCommitHandlers {
  const startRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const onDragStart = useCallback((_event: unknown, info: PanInfo) => {
    startRef.current = { x: info.point.x, y: info.point.y };
    movedRef.current = false;
  }, []);

  const onDrag = useCallback(
    (_event: unknown, info: PanInfo) => {
      if (movedRef.current) return; // 已越过阈值，无需继续计算
      const dx = info.point.x - startRef.current.x;
      const dy = info.point.y - startRef.current.y;
      if (Math.hypot(dx, dy) > threshold) movedRef.current = true;
    },
    [threshold],
  );

  const onDragEnd = useCallback(
    (_event: unknown, info: PanInfo) => {
      if (!movedRef.current) return; // 只是手抖，当成点击
      onCommit({
        clientX: info.point.x,
        clientY: info.point.y,
        offsetX: info.offset.x,
        offsetY: info.offset.y,
        velocityX: info.velocity.x,
        velocityY: info.velocity.y,
      });
    },
    [onCommit],
  );

  const wasDragged = useCallback(() => movedRef.current, []);

  return useMemo(
    () => ({ onDragStart, onDrag, onDragEnd, wasDragged }),
    [onDragStart, onDrag, onDragEnd, wasDragged],
  );
}

/** 把视图坐标换算成容器内的归一化坐标（0–100，y 轴向上为正） */
export function toNormalizedPoint(
  point: { clientX: number; clientY: number },
  container: DOMRect,
): { x: number; y: number } {
  const rawX = ((point.clientX - container.left) / container.width) * 100;
  // 屏幕坐标 y 向下为正，业务坐标 y 向上为正（"重要性"越高越靠上）
  const rawY = (1 - (point.clientY - container.top) / container.height) * 100;
  return { x: clamp(rawX, 0, 100), y: clamp(rawY, 0, 100) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
