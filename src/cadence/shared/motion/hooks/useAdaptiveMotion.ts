/**
 * 自适应动效降级
 * 依据：docs/04-动画系统设计规格.md §6.3
 *
 * 设计意图：把"设备吃不消时该关掉什么"的判断**集中在一处**，
 * 而不是让每个业务组件自己检测硬件、各自决定降级策略。
 *
 * 判断依据只用两个**同步可得**的指标：
 *   navigator.hardwareConcurrency（CPU 逻辑核心数）
 *   navigator.deviceMemory（设备内存 GB，仅 Chromium 支持）
 * 生产环境不做运行时帧率探测来决定降级 —— 那会让行为不可预测、无法复现。
 * 帧率只用于 /motion-lab 的观测（见 useFpsMeter）。
 */

import { useMemo } from "react";

import { stagger } from "../tokens";

export interface AdaptiveMotionConfig {
  /** 低端设备：关闭元素间的 FLIP 让位编排（大量 transform 计算最吃 CPU） */
  disableLayoutChoreography: boolean;
  /** 交错间隔上限（元素多时自动压缩，避免入场拖沓） */
  maxStagger: number;
  /** 极低端设备：关闭滚动联动（滚动事件的持续计算） */
  disableScrollLinked: boolean;
  /** 阴影层级档数（低端设备减少阴影，降低合成开销） */
  elevationLevels: 2 | 3;
  /** 同时参与动画的非交错元素上限 */
  maxConcurrent: number;
}

/** hardwareConcurrency 在部分环境缺失，给一个保守的默认值 */
function readCoreCount(): number {
  return typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
}

/** deviceMemory 不是标准 API，只有 Chromium 系实现；缺失时按 4GB 保守估计 */
function readDeviceMemory(): number {
  if (typeof navigator === "undefined") return 4;
  const value = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  return typeof value === "number" ? value : 4;
}

export function useAdaptiveMotion(): AdaptiveMotionConfig {
  return useMemo(() => {
    const cores = readCoreCount();
    const memory = readDeviceMemory();

    const lowEnd = cores <= 4 || memory <= 4;
    const veryLowEnd = cores <= 2;

    return {
      disableLayoutChoreography: lowEnd,
      maxStagger: lowEnd ? stagger.tight : stagger.loose,
      disableScrollLinked: veryLowEnd,
      elevationLevels: lowEnd ? 2 : 3,
      maxConcurrent: lowEnd ? 4 : 6,
    };
  }, []);
}

/**
 * 是否应当暂停持续型动画（repeat: Infinity）
 *
 * 页面不可见时暂停是硬性要求：一个看不见的无限动画仍在消耗 GPU 与电量。
 * 注意这**不能**替代 CSS 侧的 .pause-when-hidden —— 那个覆盖纯 CSS 动画，
 * 这个覆盖 Motion 驱动的动画与需要 JS 判断的场景。
 */
export function shouldPauseAmbient(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden;
}
