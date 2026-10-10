/**
 * 动效实验室（M1 验收物）
 * ---------------------------------------------------------------------------
 * 定位（04 号文档 §6.4）：这是动画系统的**验收工具**，也是开发期的唯一真相来源。
 *
 * 为什么实现放在 shared/motion/lab 而不是 pages/motion-lab：
 *   业务层（pages / widgets / features / entities）被 ESLint 禁止直接引用
 *   motion/react（红线 R7），而实验室的职责恰恰是展示动画原语本身。
 *   有两条路：给 pages/motion-lab 开一个例外，或把实验室归属于动画系统。
 *   选了后者 —— 例外一旦开了，就会有第二个。
 *   pages/motion-lab 只做一个薄壳（渲染本组件）。
 *
 * 分包：本模块被页面懒加载，独立成 chunk，不进首屏。
 */

import { useState } from "react";

import { ComponentShowcase } from "./ComponentShowcase";
import { DragSandbox } from "./DragSandbox";
import { PerfPanel } from "./PerfPanel";
import { StaggerTuner } from "./StaggerTuner";
import { TokenSection } from "./TokenSection";
import { VariantGallery } from "./VariantGallery";

const TABS = [
  {
    id: "tokens",
    label: "令牌",
    hint: "时长 / 缓动 / 弹簧",
    render: () => <TokenSection />,
  },
  {
    id: "variants",
    label: "变体画廊",
    hint: "全部变体逐个跑",
    render: () => <VariantGallery />,
  },
  {
    id: "stagger",
    label: "交错调节",
    hint: "间隔与上限的关系",
    render: () => <StaggerTuner />,
  },
  {
    id: "perf",
    label: "性能面板",
    hint: "帧率 / 长任务 / 三档切换",
    render: () => <PerfPanel />,
  },
  {
    id: "drag",
    label: "拖拽沙盒",
    hint: "证明拖拽零重渲染",
    render: () => <DragSandbox />,
  },
  {
    id: "components",
    label: "组件",
    hint: "手作化基础组件",
    render: () => <ComponentShowcase />,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MotionLab() {
  const [tab, setTab] = useState<TabId>("tokens");
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <div className="neo-motion-lab space-y-6">
      <header className="space-y-1">
        <p className="text-ink-3 text-[11px] tracking-[0.22em] uppercase">
          Motion Lab
        </p>
        <h2 className="text-2xl">动效实验室</h2>
        <p className="text-ink-2 max-w-3xl pt-1 text-[13px]">
          动画系统的验收工具。开发新功能时，动效参数先在这里比对再落到业务代码
          —— 改完不知道"变好还是变差"，靠读代码是判断不出来的。
        </p>
      </header>

      <nav
        aria-label="实验室分区"
        className="surface-inset flex flex-wrap gap-1 p-1.5"
        style={{ borderRadius: "var(--radius-hand-pill)" }}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === tab ? "page" : undefined}
            title={item.hint}
            onClick={() => setTab(item.id)}
            className={[
              "craft-transition-fast rounded-[var(--radius-hand-pill)] px-4 py-2 text-[12.5px]",
              item.id === tab
                ? "bg-paper-1 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-paper-line)]"
                : "text-ink-3 hover:text-ink-1",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div key={tab}>{active.render()}</div>
    </div>
  );
}
