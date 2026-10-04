/**
 * 交错容器（L3 模式层）
 * ---------------------------------------------------------------------------
 * 解决的问题：手写交错需要定义一套 listContainer 变体、算间隔、处理上限，
 * 而这件事在业务代码里会重复几十次，且很容易漏掉"元素多了要压缩间隔"。
 *
 * 子元素数量由 React.Children.count 自动推断，调用方不需要传 count
 * （传了容易和实际不符，属于典型的双写不一致）。
 *
 * 用法：把每个子元素包在 <m.div variants={rise|placeOn|...}> 里即可，
 * variants 会沿组件树下传，无需手动把 variants 传给 StaggerGroup。
 */

import { Children, type ReactNode } from "react";

import { listContainer, m } from "@/cadence/shared/motion";
import {
  useAdaptiveMotion,
  useResolvedVariants,
  useStaggerTiming,
} from "@/cadence/shared/motion";

interface StaggerGroupProps {
  children: ReactNode;
  /** 覆盖自动推断的子元素数量 */
  count?: number;
  /** 基础间隔；默认用自适应上限（低端设备自动收紧） */
  baseInterval?: number;
  /** 关闭交错（只看容器本身） */
  disabled?: boolean;
  /** 容器标签：列表语义用 ul */
  as?: "div" | "ul" | "ol";
  className?: string;
}

const STAGGER_LIMIT = 12;

export function StaggerGroup({
  children,
  count,
  baseInterval,
  disabled = false,
  as = "div",
  className,
}: StaggerGroupProps) {
  const adaptive = useAdaptiveMotion();
  const actualCount = count ?? Children.count(children);
  const enabled = !disabled && actualCount <= STAGGER_LIMIT;
  const { interval } = useStaggerTiming(
    actualCount,
    baseInterval ?? adaptive.maxStagger,
  );

  const variants = useResolvedVariants(
    enabled
      ? listContainer(interval)
      : {
          hidden: { opacity: 1 },
          visible: { opacity: 1 },
          exit: { opacity: 1 },
        },
  );

  const Wrapper = as === "ul" ? m.ul : as === "ol" ? m.ol : m.div;

  return (
    <Wrapper
      className={className}
      variants={variants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </Wrapper>
  );
}
