/**
 * 分区判定（派生，不落库）
 * 依据：01-需求文档 关键设计决策 3、FR-TODO-09；02-技术架构文档 §4.3
 *
 * 为什么 zoneId 不存储：坐标与分区若都存储，改分区配置后两者可能不一致
 * （双写问题）。派生计算让"改配置 → 全部待办自动归位"成为零成本操作。
 */

import type { AxisConfig, ZoneId, ZoneRegion } from "./model";

/**
 * 坐标判定用左闭右开：`x >= x0 && x < x1`
 *
 * 若用闭区间，相邻分区在边界线上会同时命中，归属产生歧义。
 * 左闭右开保证每个坐标**有且仅有一个**归属。
 *
 * 例外：区间右端恰好是 100 时用闭区间。坐标域是 [0, 100]（两端都可达），
 * 半开约定在域的右端点会漏判 —— (100, 100) 这个点必须归属到右上角的分区，
 * 而不是掉进 fallback。此规则需在设置页向用户说明（01-需求文档 第 7 章）。
 */
function withinAxis(value: number, lo: number, hi: number): boolean {
  if (value < lo) return false;
  if (value < hi) return true;
  return hi === 100 && value <= 100;
}

/** 判断坐标落在哪个分区。按 order 自小到大匹配第一个命中的分区 */
export function resolveZone(
  axis: AxisConfig,
  point: { x: number; y: number },
): ZoneId {
  const hit = [...axis.regions]
    .sort((a, b) => a.order - b.order)
    .find(
      (region: ZoneRegion) =>
        withinAxis(point.x, region.x0, region.x1) &&
        withinAxis(point.y, region.y0, region.y1),
    );

  return hit?.id ?? axis.fallbackZoneId;
}

/**
 * 分区归属的批量版本
 *
 * XY 视图一次要给几百条待办算分区。`resolveZone` 每次都会复制并排序 regions
 * （O(n log n)），200 条待办就是 200 次排序。预先排序一次再逐条判定，
 * 是这里唯一值得做的优化。
 */
export function resolveZones(
  axis: AxisConfig,
  points: readonly { x: number; y: number }[],
): ZoneId[] {
  const ordered = [...axis.regions].sort((a, b) => a.order - b.order);
  return points.map((point) => {
    const hit = ordered.find(
      (region) =>
        withinAxis(point.x, region.x0, region.x1) &&
        withinAxis(point.y, region.y0, region.y1),
    );
    return hit?.id ?? axis.fallbackZoneId;
  });
}

/** 分区 id → 分区定义（列表渲染标签与配色用） */
export function regionById(
  axis: AxisConfig,
  zoneId: ZoneId,
): ZoneRegion | undefined {
  return axis.regions.find((region) => region.id === zoneId);
}
