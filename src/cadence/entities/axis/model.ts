/**
 * XY 轴与分区配置
 * 依据：01-需求文档 FR-TODO-05（2×2 / 3×3 / 自定义矩形集合）
 */

import type { Timestamped } from "@/cadence/shared/model/entity";
import type { PigmentKey } from "@/cadence/shared/config/pigment";

export type AxisConfigId = string;
export type ZoneId = string;

/**
 * 分区矩形
 *
 * 坐标系：x 向右、y 向上，取值 0–100（与待办坐标同一坐标系）。
 * `x0/y0` 是左下角，`x1/y1` 是右上角，要求 x0 < x1 且 y0 < y1。
 * 归属判定用**左闭右开**（见 zone.ts 顶部的说明），因此相邻矩形不会在边界上同时命中。
 */
export interface ZoneRegion {
  id: ZoneId;
  label: string;
  /** 颜料语义色：分区标签与看板底色共用一套色板 */
  color: PigmentKey;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 匹配顺序：越小的 order 越先判定。重叠分区时 order 决定归属 */
  order: number;
}

export interface AxisConfig extends Timestamped {
  id: AxisConfigId;
  name: string;
  /** X 轴含义（如"紧急程度"） */
  axisXLabel: string;
  /** Y 轴含义（如"重要性"） */
  axisYLabel: string;
  /** 分区矩形集合；顺序无关，匹配按 order */
  regions: ZoneRegion[];
  /**
   * 没有命中任何分区时的兜底分区 id。
   * 必须指向 regions 中的某一个 —— 否则一个坐标会"无家可归"。
   */
  fallbackZoneId: ZoneId;
  /** 默认轴配置：新建待办时使用；全局只有一个（由 repo 保证） */
  isDefault: boolean;
}

/** 校验分区矩形的几何约束（x0<x1, y0<y1, 数值在 0–100 内） */
export function isValidRegion(region: ZoneRegion): boolean {
  const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  return (
    inRange(region.x0) &&
    inRange(region.x1) &&
    inRange(region.y0) &&
    inRange(region.y1) &&
    region.x0 < region.x1 &&
    region.y0 < region.y1
  );
}

/** 内置四象限配置：优先级矩阵（重要性 × 紧急程度） */
export function defaultAxisConfig(now: number): AxisConfig {
  return {
    id: "axis-priority",
    name: "优先级矩阵",
    axisXLabel: "紧急程度",
    axisYLabel: "重要性",
    regions: [
      // 颜色用颜料语义键（PigmentKey），不是色值也不是色系名 ——
      // 这样看板底色与分区标签共用同一套语义，改色板时不会漏改
      {
        id: "zone-do-first",
        label: "立即做",
        color: "session",
        x0: 50,
        y0: 50,
        x1: 100,
        y1: 100,
        order: 0,
      },
      {
        id: "zone-plan",
        label: "计划",
        color: "plan",
        x0: 0,
        y0: 50,
        x1: 50,
        y1: 100,
        order: 1,
      },
      {
        id: "zone-delegate",
        label: "委托",
        color: "todo",
        x0: 50,
        y0: 0,
        x1: 100,
        y1: 50,
        order: 2,
      },
      {
        id: "zone-later",
        label: "延后",
        color: "review",
        x0: 0,
        y0: 0,
        x1: 50,
        y1: 50,
        order: 3,
      },
    ],
    fallbackZoneId: "zone-later",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}
