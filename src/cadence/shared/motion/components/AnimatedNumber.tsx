/**
 * 数字滚动组件
 * ---------------------------------------------------------------------------
 * 动画期间直接改 textContent，不触发 React 重渲染（性能红线 R3 / NFR-PERF-07）。
 *
 * ⚠️ 数字必须用等宽字体（组件已默认挂上 .numeric）：
 *    否则 1 与 8 的宽度不同，滚动过程中整行会左右抖动。
 */

import { useEffect, useRef } from "react";

import {
  formatAnimatedNumber,
  useAnimatedNumber,
  useAnimatedNumberFormat,
  type AnimatedNumberOptions,
} from "../hooks/useAnimatedNumber";

export function AnimatedNumber({
  value,
  className,
  ...options
}: AnimatedNumberOptions & { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useAnimatedNumber(value, options);

  // formatKey 是归一化后的稳定依赖串，避免 options 对象字面量导致每次渲染重新订阅
  const formatKey = useAnimatedNumberFormat(options).join("|");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const write = (current: number) => {
      if (ref.current)
        ref.current.textContent = formatAnimatedNumber(
          current,
          optionsRef.current,
        );
    };
    write(motionValue.get());
    return motionValue.on("change", write);
  }, [motionValue, formatKey]);

  return (
    <span
      ref={ref}
      className={["numeric", className].filter(Boolean).join(" ")}
    />
  );
}
