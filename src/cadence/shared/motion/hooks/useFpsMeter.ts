/**
 * 帧率与长任务计量（仅供 /motion-lab 的观测面板使用）
 * ---------------------------------------------------------------------------
 * 定位说明：这是**观测工具**，不是运行时降级依据。
 *   运行时降级走 useAdaptiveMotion 的静态硬件判断（可预测、可复现）；
 *   本 Hook 只用于开发/验收时把"这里到底卡不卡"变成可读的数字。
 *
 * 采样策略：rAF 逐帧计差，但每 500ms 才更新一次 state。
 *   若逐帧 setState，观测工具本身就会成为掉帧的原因 —— 那就失去意义了。
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface FpsStats {
  /** 最近一个采样窗口的平均帧率 */
  fps: number;
  /** 本次观测中出现过的最低帧率 */
  minFps: number;
  /** 长任务（> 50ms）次数 —— 性能预算要求占比 < 2% */
  longTasks: number;
  /** 最长的一次长任务耗时（ms） */
  worstLongTask: number;
  /** 超过 20ms 的掉帧次数（60fps 下单帧预算 16.7ms） */
  droppedFrames: number;
}

const SAMPLE_WINDOW_MS = 500;
const DROPPED_FRAME_MS = 20;
const LONG_TASK_MS = 50;

const EMPTY_STATS: FpsStats = {
  fps: 0,
  minFps: 0,
  longTasks: 0,
  worstLongTask: 0,
  droppedFrames: 0,
};

export function useFpsMeter(active = true): FpsStats & { reset: () => void } {
  const [stats, setStats] = useState<FpsStats>(EMPTY_STATS);

  const framesRef = useRef(0);
  const windowStartRef = useRef(0);
  const minFpsRef = useRef(Number.POSITIVE_INFINITY);
  const droppedRef = useRef(0);
  const longTasksRef = useRef(0);
  const worstLongTaskRef = useRef(0);
  const lastFrameRef = useRef(0);

  const reset = useCallback(() => {
    framesRef.current = 0;
    windowStartRef.current = performance.now();
    minFpsRef.current = Number.POSITIVE_INFINITY;
    droppedRef.current = 0;
    longTasksRef.current = 0;
    worstLongTaskRef.current = 0;
    lastFrameRef.current = performance.now();
    setStats(EMPTY_STATS);
  }, []);

  useEffect(() => {
    if (!active) return;

    let rafId = 0;
    const now = () => performance.now();
    windowStartRef.current = now();
    lastFrameRef.current = now();

    const tick = () => {
      const time = now();
      const delta = time - lastFrameRef.current;
      lastFrameRef.current = time;
      framesRef.current += 1;
      if (delta > DROPPED_FRAME_MS) droppedRef.current += 1;

      const elapsed = time - windowStartRef.current;
      if (elapsed >= SAMPLE_WINDOW_MS) {
        const fps = (framesRef.current * 1000) / elapsed;
        minFpsRef.current = Math.min(minFpsRef.current, fps);
        setStats({
          fps: Math.round(fps),
          minFps: Math.round(minFpsRef.current),
          longTasks: longTasksRef.current,
          worstLongTask: Math.round(worstLongTaskRef.current),
          droppedFrames: droppedRef.current,
        });
        framesRef.current = 0;
        windowStartRef.current = time;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    // 长任务观测：Safari 与部分 WebView 不支持 longtask，静默跳过即可
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasksRef.current += 1;
          if (entry.duration > worstLongTaskRef.current) {
            worstLongTaskRef.current = entry.duration;
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = undefined;
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [active]);

  return { ...stats, reset };
}

export { DROPPED_FRAME_MS, LONG_TASK_MS };
