/**
 * 列表增删（L3 模式层）
 * ---------------------------------------------------------------------------
 * 三件事一起处理：增删的退出动画、位置变化的 FLIP 让位、入场的交错编排。
 *
 * 关键实现选择与理由：
 *
 * 1. `mode="popLayout"`
 *    退出元素会脱离文档流（绝对定位），其余元素立即让位。
 *    若用默认的 sync 模式，退出元素在动画期间仍占着位置，列表会明显"抽动"。
 *
 * 2. `layout="position"`
 *    只做位置 FLIP，不做尺寸 FLIP。尺寸用 scale 表达会拉伸文字，
 *    而计划/待办条目的文字长度差异大，被拉伸的观感很差。
 *
 * 3. 超过 12 项自动关闭交错
 *    30 项若按 0.055 逐项入场，总时长会到 1.6 秒 —— 用户会觉得卡。
 *    间隔本身由 staggerInterval 封顶，这里再叠一层"数量多就不交错"的策略。
 *
 * 4. `AnimatePresence initial={false}`
 *    首屏已有数据时不重播整列表的入场；只有后续增删才播放动画。
 *
 * 职责边界：本组件只负责 `<ul>`。需要任意容器 + 交错时用 `<StaggerGroup>`。
 *
 * ⚠️ **禁止用于虚拟化列表**（红线 R4）
 *    虚拟化会复用 DOM 节点，FLIP 计算会拿到错误的起始位置，
 *    表现为元素从屏幕外飞入或位置错乱。
 *    虚拟化场景请只用 opacity + translateY，且不要挂 layout / AnimatePresence。
 */

import type { ReactNode } from "react";

import {
  AnimatePresence,
  listContainer,
  listItem,
  m,
} from "@/cadence/shared/motion";
import {
  useAdaptiveMotion,
  useResolvedVariants,
  useStaggerTiming,
} from "@/cadence/shared/motion";

interface AnimatedListProps<T> {
  items: readonly T[];
  /** 稳定唯一键。务必用实体 id，不要用数组下标 —— 下标会让 FLIP 认错元素 */
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** 是否启用交错入场；不传则按数量自动决定 */
  stagger?: boolean;
  /** 空状态；为空数组时渲染它 */
  empty?: ReactNode;
  className?: string;
  itemClassName?: string;
}

const STAGGER_LIMIT = 12;

/** 关闭交错时的等价变体：保持状态定义完整，只是没有 staggerChildren */
const NO_STAGGER = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
  exit: { opacity: 1 },
} as const;

export function AnimatedList<T>({
  items,
  getKey,
  renderItem,
  stagger,
  empty,
  className,
  itemClassName,
}: AnimatedListProps<T>) {
  const adaptive = useAdaptiveMotion();
  const useStagger = stagger ?? items.length <= STAGGER_LIMIT;
  const { interval } = useStaggerTiming(items.length, adaptive.maxStagger);

  const containerVariants = useResolvedVariants(
    useStagger ? listContainer(interval) : NO_STAGGER,
  );
  const itemVariants = useResolvedVariants(listItem);

  if (items.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <m.ul
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item, index) => (
          <m.li
            key={getKey(item)}
            layout="position"
            variants={itemVariants}
            className={itemClassName}
          >
            {renderItem(item, index)}
          </m.li>
        ))}
      </AnimatePresence>
    </m.ul>
  );
}
