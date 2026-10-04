/**
 * 页头（无业务基础组件）
 * 统一 6 个一级页面的标题层级：小节英文标签 → 中文大标题 → 手绘下划线。
 */

import type { ReactNode } from "react";

import { HandRule } from "@/cadence/shared/motion";

interface PageHeaderProps {
  /** 小节标签，如 "Plans" */
  eyebrow: string;
  title: string;
  description?: string;
  /** 下划线形状，各页面错开可避免视觉雷同 */
  rule?: "wave" | "ripple" | "gentle";
  /** 右上角操作区（如"新建计划"按钮） */
  action?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  rule = "wave",
  action,
}: PageHeaderProps) {
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-ink-3 text-[11px] tracking-[0.22em] uppercase">
            {eyebrow}
          </p>
          <h2 className="text-2xl">{title}</h2>
          <HandRule shape={rule} tone="mark" className="max-w-40" />
        </div>
        {action ? <div className="shrink-0 pt-1">{action}</div> : null}
      </div>
      {description ? (
        <p className="text-ink-2 max-w-3xl pt-2 text-[13.5px]">{description}</p>
      ) : null}
    </header>
  );
}
