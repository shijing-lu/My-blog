/**
 * 数字滚动的动效参数
 * ---------------------------------------------------------------------------
 * 组件实现见 ../components/AnimatedNumber.tsx
 *
 * 关键实现决策：动画过程中**不触发 React 重渲染**。
 *
 * 直觉写法是把当前值放进 state（每帧 setState），但数字滚动动辄 700ms，
 * 60fps 下就是 42 次重渲染 —— 对于一个只变几个字的元素，这个代价完全不成比例，
 * 而且会连带重渲染它的兄弟节点。
 *
 * 这里的做法：用 MotionValue 承载插值，由组件通过 ref 直接写 textContent。
 * React 只在 value 属性变化时渲染一次。
 */

import { animate, useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useMemo } from "react";

import { useMotionStrength } from "@/cadence/shared/store/appearance-store";
import { duration, ease } from "../tokens";
import { resolveMotion } from "../utils";

export interface AnimatedNumberOptions {
  /** 小数位数 */
  decimals?: number | undefined;
  /** 单位后缀，如 "h" / "%" */
  suffix?: string | undefined;
  /** 前缀，如 "¥" */
  prefix?: string | undefined;
  /** 是否使用千分位 */
  grouping?: boolean | undefined;
  /** 自定义时长；默认 deliberate（720ms，属"环境动效"档） */
  transitionDuration?: number | undefined;
}

export const DEFAULT_ANIMATED_NUMBER: Required<
  Omit<AnimatedNumberOptions, "transitionDuration">
> = {
  decimals: 0,
  suffix: "",
  prefix: "",
  grouping: false,
};

/** 返回一个受动效强度控制的数字 MotionValue（需要自行订阅渲染时用） */
export function useAnimatedNumber(
  value: number,
  options: AnimatedNumberOptions = {},
): MotionValue<number> {
  const { transitionDuration = duration.deliberate } = options;
  const strength = useMotionStrength();
  const motionValue = useMotionValue(value);

  useEffect(() => {
    const controls = animate(
      motionValue,
      value,
      resolveMotion(
        { duration: transitionDuration, ease: ease.decelerate },
        strength,
      ),
    );
    return () => controls.stop();
  }, [value, transitionDuration, strength, motionValue]);

  return motionValue;
}

/** 统一的数字格式化，保证动画中途与最终值的格式完全一致 */
export function formatAnimatedNumber(
  value: number,
  options: AnimatedNumberOptions,
): string {
  const { decimals, grouping, prefix, suffix } = {
    ...DEFAULT_ANIMATED_NUMBER,
    ...options,
  };
  const body = grouping
    ? new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value)
    : value.toFixed(decimals);
  return `${prefix}${body}${suffix}`;
}

/** 把选项归一化成稳定的依赖数组，避免每次渲染重新订阅 MotionValue */
export function useAnimatedNumberFormat(
  options: AnimatedNumberOptions,
): string[] {
  const { decimals, grouping, prefix, suffix } = {
    ...DEFAULT_ANIMATED_NUMBER,
    ...options,
  };
  return useMemo(
    () => [String(decimals), String(grouping), prefix ?? "", suffix ?? ""],
    [decimals, grouping, prefix, suffix],
  );
}
