/**
 * 共享元素迁移（L3 模式层）
 * ---------------------------------------------------------------------------
 * 用途：从列表点进详情时，让标题/卡片"飞"到新位置，而不是整页跳变。
 * 这是让用户理解"我还在看同一个东西"的最有效手段。
 *
 * ⚠️ 使用限制（踩过才知道的坑）
 *
 * 1. `layoutId` 要求**两个视图同时存在于 DOM 中**。
 *    因此这条路由的转场不能用 `mode="wait"`（旧页面完全退出后新页面才进入），
 *    必须用 `mode="popLayout"` 或 `sync`。
 *    本项目只在一处使用共享元素（列表 → 详情），该路由单独配置。
 *
 * 2. 同一时刻 `layoutId` 必须全局唯一，否则会出现"元素飞到错误的地方"。
 *    用 `sharedElementId(kind, id)` 生成，不要手拼字符串
 *    —— 手拼很容易漏掉 kind 前缀，两处不同实体的 id 恰好相同时就会打架。
 *
 * 3. 迁移的元素**尺寸差异不宜过大**（如列表里的 14px 标题 → 详情页的 32px 标题
 *    是合理的；一个 80px 的便利贴 → 全屏面板则会产生夸张的拉伸）。
 *    尺寸跨度大时只迁移标题，容器单独做面板入场。
 */

import type { ReactNode } from "react";

import { m } from "@/cadence/shared/motion";

interface SharedElementProps {
  /** 用 sharedElementId() 生成，不要手拼 */
  layoutId: string;
  children: ReactNode;
  className?: string;
  /** 是否为迁移的"终点"；终点用默认的 spring.smooth 即可 */
  as?: "div" | "span" | "h1" | "h2" | "h3";
}

export function SharedElement({
  layoutId,
  children,
  className,
  as = "div",
}: SharedElementProps) {
  const Wrapper =
    as === "span"
      ? m.span
      : as === "h1"
        ? m.h1
        : as === "h2"
          ? m.h2
          : as === "h3"
            ? m.h3
            : m.div;

  return (
    <Wrapper
      layoutId={layoutId}
      className={className}
      style={{ willChange: "transform" }}
    >
      {children}
    </Wrapper>
  );
}
