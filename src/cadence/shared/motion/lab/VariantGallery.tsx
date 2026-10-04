/**
 * 动效实验室 · 变体画廊
 * ---------------------------------------------------------------------------
 * 把全部变体逐个跑一遍 —— 这是判断"这个动效到底对不对"的唯一可靠方式。
 *
 * 渲染策略按变体的**物理形态**分三类，而不是给每个变体写一段专门代码：
 *   shape —— 纸片（绝大多数位移/缩放/旋转类变体）
 *   path  —— SVG 路径（drawIn / checkPath 这类笔触绘制）
 *   dot   —— 小圆点（wobble / pulse 这类持续型环境动效）
 *
 * 这样新增变体时只需在列表里加一行，不需要写新的演示组件。
 */

import type { Variants } from "motion/react";
import { m } from "motion/react";
import { useCallback, useState } from "react";

import { useResolvedVariants } from "../hooks";
import * as collections from "../variants/collections";
import * as craft from "../variants/craft";
import * as feedback from "../variants/feedback";
import * as primitives from "../variants/primitives";
import * as surfaces from "../variants/surfaces";

type RenderKind = "shape" | "path" | "dot";

interface VariantEntry {
  name: string;
  group:
    | "原型 primitives"
    | "手作 craft"
    | "集合 collections"
    | "表面 surfaces"
    | "反馈 feedback";
  variants: Variants;
  kind: RenderKind;
  note: string;
}

/** slide 是参数化工厂，展开成两个方向 */
const ENTRIES: VariantEntry[] = [
  // ── 原型 ──
  {
    name: "fade",
    group: "原型 primitives",
    variants: primitives.fade,
    kind: "shape",
    note: "无位移，文字密集区与降级路径的兜底",
  },
  {
    name: "rise",
    group: "原型 primitives",
    variants: primitives.rise,
    kind: "shape",
    note: "无旋转升起，用于文字密集区块",
  },
  {
    name: "scaleIn",
    group: "原型 primitives",
    variants: primitives.scaleIn,
    kind: "shape",
    note: "卡片、弹层",
  },
  {
    name: "pop",
    group: "原型 primitives",
    variants: primitives.pop,
    kind: "shape",
    note: "强调反馈，bouncy 弹簧",
  },
  {
    name: "collapse",
    group: "原型 primitives",
    variants: primitives.collapse,
    kind: "shape",
    note: "高度展开（唯一允许动尺寸的场景）",
  },
  {
    name: "slide · right",
    group: "原型 primitives",
    variants: primitives.slide("right"),
    kind: "shape",
    note: "侧向滑入",
  },
  {
    name: "slide · left",
    group: "原型 primitives",
    variants: primitives.slide("left"),
    kind: "shape",
    note: "侧向滑入",
  },

  // ── 手作 ──
  {
    name: "drawIn",
    group: "手作 craft",
    variants: craft.drawIn,
    kind: "path",
    note: "笔触自绘 · 唯一在 reduced-motion 下保留的手作原型",
  },
  {
    name: "stampIn",
    group: "手作 craft",
    variants: craft.stampIn,
    kind: "shape",
    note: "盖印 · 任务级完成、徽记",
  },
  {
    name: "smudge",
    group: "手作 craft",
    variants: craft.smudge,
    kind: "shape",
    note: "晕开 · 含 blur 过渡，面积须 ≤200×200px",
  },
  {
    name: "smudgeLite",
    group: "手作 craft",
    variants: craft.smudgeLite,
    kind: "shape",
    note: "无 blur 版本 · 大面积元素必须用这个",
  },
  {
    name: "wobble",
    group: "手作 craft",
    variants: craft.wobble,
    kind: "dot",
    note: "摇曳 · ±0.6°、≤24px、页面隐藏时暂停",
  },
  {
    name: "unwrap",
    group: "手作 craft",
    variants: craft.unwrap,
    kind: "shape",
    note: "卷纸展开 · 任务详情、复盘表单",
  },
  {
    name: "placeOn",
    group: "手作 craft",
    variants: craft.placeOn,
    kind: "shape",
    note: "摆上去 · 默认卡片入场（带 ±1.2° 旋转）",
  },

  // ── 集合 ──
  {
    name: "listItem",
    group: "集合 collections",
    variants: collections.listItem,
    kind: "shape",
    note: "列表项 · 配合 AnimatePresence popLayout",
  },
  {
    name: "treeChildren",
    group: "集合 collections",
    variants: collections.treeChildren,
    kind: "shape",
    note: "任务树子树 · beforeChildren",
  },
  {
    name: "gridItem",
    group: "集合 collections",
    variants: collections.gridItem,
    kind: "shape",
    note: "网格卡片 · 交错更大",
  },

  // ── 表面 ──
  {
    name: "pageForward",
    group: "表面 surfaces",
    variants: surfaces.pageForward,
    kind: "shape",
    note: "路由下钻",
  },
  {
    name: "pageBack",
    group: "表面 surfaces",
    variants: surfaces.pageBack,
    kind: "shape",
    note: "路由返回",
  },
  {
    name: "pageLateral",
    group: "表面 surfaces",
    variants: surfaces.pageLateral,
    kind: "shape",
    note: "同级切换 · 不加方向性位移，避免误导层级",
  },
  {
    name: "modalPanel",
    group: "表面 surfaces",
    variants: surfaces.modalPanel,
    kind: "shape",
    note: "模态面板",
  },
  {
    name: "backdrop",
    group: "表面 surfaces",
    variants: surfaces.backdrop,
    kind: "shape",
    note: "遮罩 · 暖褐半透明而非纯黑",
  },
  {
    name: "drawerRight",
    group: "表面 surfaces",
    variants: surfaces.drawerRight,
    kind: "shape",
    note: "侧边抽屉",
  },
  {
    name: "sheetBottom",
    group: "表面 surfaces",
    variants: surfaces.sheetBottom,
    kind: "shape",
    note: "底部面板（移动端）",
  },
  {
    name: "toast",
    group: "表面 surfaces",
    variants: surfaces.toast,
    kind: "shape",
    note: "轻提示 · 像递过来的一张便签",
  },

  // ── 反馈 ──
  {
    name: "checkPop",
    group: "反馈 feedback",
    variants: feedback.checkPop,
    kind: "shape",
    note: "勾选外框 · 高频，保持快速",
  },
  {
    name: "checkPath",
    group: "反馈 feedback",
    variants: feedback.checkPath,
    kind: "path",
    note: "勾形绘制 · 信息性动画，reduced-motion 下保留",
  },
  {
    name: "completeCard",
    group: "反馈 feedback",
    variants: feedback.completeCard,
    kind: "shape",
    note: "任务完成脉冲",
  },
  {
    name: "pulse",
    group: "反馈 feedback",
    variants: feedback.pulse,
    kind: "dot",
    note: "呼吸点 · 中性场景（计时优先用 wobble）",
  },
];

const GROUPS = [
  "原型 primitives",
  "手作 craft",
  "集合 collections",
  "表面 surfaces",
  "反馈 feedback",
] as const;

/** 纸片演示：承载位移/缩放/旋转类变体 */
function ShapeStage({
  variants,
  replayKey,
}: {
  variants: Variants;
  replayKey: number;
}) {
  const resolved = useResolvedVariants(variants);
  return (
    <div className="grid h-24 place-items-center overflow-hidden">
      <m.div
        key={replayKey}
        variants={resolved}
        initial="hidden"
        animate={variants === feedback.completeCard ? "completing" : "visible"}
        className="bg-amber-soft shadow-[inset_0_0_0_1.5px_var(--color-amber-base)] grid h-12 w-16 place-items-center rounded-[var(--radius-hand-sm)]"
      >
        <span className="text-amber-deep text-[10px]">纸片</span>
      </m.div>
    </div>
  );
}

/** 路径演示：承载笔触绘制类变体 */
function PathStage({
  variants,
  replayKey,
}: {
  variants: Variants;
  replayKey: number;
}) {
  const resolved = useResolvedVariants(variants);
  const isCheck = variants === feedback.checkPath;
  return (
    <div className="grid h-24 place-items-center">
      <svg viewBox="0 0 60 60" width={52} height={52} aria-hidden="true">
        <m.path
          key={replayKey}
          d={
            isCheck
              ? "M14 32 L26 44 L48 16"
              : "M6 44 C18 12 30 52 42 22 S54 34 54 30"
          }
          fill="none"
          stroke="var(--color-amber-base)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          variants={resolved}
          initial="hidden"
          animate={isCheck ? "checked" : "visible"}
        />
      </svg>
    </div>
  );
}

/** 圆点演示：承载持续型环境动效 */
function DotStage({
  variants,
  replayKey,
}: {
  variants: Variants;
  replayKey: number;
}) {
  const resolved = useResolvedVariants(variants);
  return (
    <div className="grid h-24 place-items-center">
      <m.span
        key={replayKey}
        aria-hidden="true"
        className="pause-when-hidden bg-clay-base shadow-[0_0_0_5px_var(--color-clay-soft)] block h-[22px] w-[22px] rounded-full"
        variants={resolved}
        initial="idle"
        animate="active"
      />
    </div>
  );
}

function VariantTile({
  entry,
  replayKey,
}: {
  entry: VariantEntry;
  replayKey: number;
}) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="numeric text-ink-1 text-[12.5px] font-medium">
          {entry.name}
        </p>
      </div>
      <p className="text-ink-4 mt-0.5 text-[10.5px] leading-snug">
        {entry.note}
      </p>

      <div className="surface-inset mt-3 overflow-hidden">
        {entry.kind === "shape" ? (
          <ShapeStage variants={entry.variants} replayKey={replayKey} />
        ) : entry.kind === "path" ? (
          <PathStage variants={entry.variants} replayKey={replayKey} />
        ) : (
          <DotStage variants={entry.variants} replayKey={replayKey} />
        )}
      </div>
    </div>
  );
}

export function VariantGallery() {
  const [key, setKey] = useState(0);
  const replay = useCallback(() => setKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-ink-3 text-[12px]">
          共 <b className="numeric text-ink-1">{ENTRIES.length}</b> 个变体。
          点"全部重放"可一次性重跑所有动画 ——
          这比逐个点开更接近真实使用时的观感。
        </p>
        <button
          type="button"
          onClick={replay}
          className="craft-transition-fast text-paper-base shrink-0 rounded-[var(--radius-hand-pill)] bg-amber-deep px-4 py-2 text-[12.5px] hover:bg-amber-base"
        >
          全部重放
        </button>
      </div>

      {GROUPS.map((group) => {
        const items = ENTRIES.filter((entry) => entry.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="text-ink-1 mb-3 text-[14px]">
              {group}
              <span className="text-ink-4 numeric ml-2 text-[11.5px]">
                {items.length}
              </span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((entry) => (
                <VariantTile key={entry.name} entry={entry} replayKey={key} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
