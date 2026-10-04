/**
 * 动画系统公开出口（L2 资产层）
 * ---------------------------------------------------------------------------
 * 业务层（features / entities / widgets / pages）**只能从这里导入**。
 * ESLint 会拦截对 motion/react 的直接引用（红线 R7）。
 *
 * 未在此导出的内容属于动画系统内部实现，不应被业务代码使用。
 */

/* ── 动画原语出口 ──
 * 只放行 m（不是 motion）与 AnimatePresence，以及 MotionValue 系列。
 * 业务层因此永远不需要直接 import 'motion/react'（红线 R7），
 * 将来若更换动画库，改动面也只在这一层。
 *
 * useMotionValue / useTransform / useSpring 是**必须**放行的：
 * XY 看板这类高频交互要用它们绕开 React 渲染（红线 R3），
 * 而看板在 features 层，按规则不能直接碰动画库。
 *
 * 注意：放行原语不等于放开红线 —— R1（禁止动画布局属性）、
 * R2（禁止 transition-all）、R8（禁止 motion.* 全量组件）仍由 ESLint 强制。 */
export {
  AnimatePresence,
  m,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
export type { MotionValue, PanInfo, Transition, Variants } from "motion/react";

/* ── L1 令牌层 ── */
export {
  BLOCKING_MAX_SECONDS,
  cssEase,
  distance,
  duration,
  ease,
  rotation,
  scaleFrom,
  spring,
  stagger,
} from "./tokens";

/* ── 解析与降级工具 ── */
export {
  collapseVariants,
  drawOffset,
  resolveMotion,
  resolveVariants,
  sharedElementId,
  staggerInterval,
  staggerTotal,
} from "./utils";

/* ── L2 变体库 ── */
export {
  collapse,
  fade,
  pop,
  rise,
  scaleIn,
  slide,
} from "./variants/primitives";
export {
  drawIn,
  placeOn,
  smudge,
  smudgeLite,
  stampIn,
  unwrap,
  wobble,
} from "./variants/craft";
export {
  gridItem,
  listContainer,
  listItem,
  treeChildren,
} from "./variants/collections";
export {
  backdrop,
  drawerRight,
  modalPanel,
  pageBack,
  pageForward,
  pageLateral,
  sheetBottom,
  toast,
} from "./variants/surfaces";
export {
  checkPath,
  checkPop,
  completeCard,
  progressFill,
  pulse,
} from "./variants/feedback";

/* ── Hooks ── */
export {
  clamp,
  formatAnimatedNumber,
  shouldPauseAmbient,
  toNormalizedPoint,
  useAdaptiveMotion,
  useAnimatedNumber,
  useDragCommit,
  useFpsMeter,
  useMotionStrength,
  useResolvedMotion,
  useResolvedVariants,
  useScrollLinkedProgress,
  useStaggerTiming,
  type AdaptiveMotionConfig,
  type AnimatedNumberOptions,
  type DragCommitHandlers,
  type DragCommitOptions,
  type DragCommitPoint,
  type FpsStats,
} from "./hooks";

/* ── 质感与模式组件 ── */
export { AnimatedList } from "./components/AnimatedList";
export { AnimatedNumber } from "./components/AnimatedNumber";
export { Collapsible } from "./components/Collapsible";
export { DraggableSurface } from "./components/DraggableSurface";
export { HandRule, type HandRuleShape } from "./components/HandRule";
export {
  MotionRoute,
  type TransitionDirection,
} from "./components/MotionRoute";
export { PresenceDialog } from "./components/PresenceDialog";
export { PresenceSheet } from "./components/PresenceSheet";
export { SharedElement } from "./components/SharedElement";
export { StaggerGroup } from "./components/StaggerGroup";
export {
  StickyNote,
  StickyNoteStatic,
  type StickySize,
  type StickyTone,
} from "./components/StickyNote";
