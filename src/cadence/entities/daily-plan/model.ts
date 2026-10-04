/**
 * 每日计划实体
 * 依据：docs/07-每日计划模块.md
 * ---------------------------------------------------------------------------
 * 定位：**一天的执行清单**，介于"计划（长期目标容器）"与"待办（无时间归属）"之间。
 *
 * 与其他模块的边界（联动契约详见 docs/07 §3）：
 *   - 一天只有一份（dateKey 唯一），内容项内嵌存储、整体读写 ——
 *     日计划的量级（≤ 20 项）不值得为它建子表。
 *   - 条目可引用任务（task）或待办（todo），也可以是自由条目（free）；
 *     引用存 refId + 冗余标题：源被删除时日项不消失，只是标记"源已删除"。
 *   - 勾选日项 → **正向**同步完成引用的任务；反向不联动（在任务树勾完成
 *     不会自动勾日项）—— 避免双写循环，语义见 docs/07 §3.2。
 */

import type { Timestamped } from "@/cadence/shared/model/entity";

export type DailyPlanId = string;

/** 条目来源：引用任务 / 引用待办 / 自由条目（只属于今天的事） */
export type DailyItemKind = "task" | "todo" | "free";

export interface DailyPlanItem {
  id: string;
  kind: DailyItemKind;
  /** 引用源 id（task / todo）；free 为 undefined */
  refId?: string | undefined;
  /**
   * 冗余标题：渲染不依赖 join；源删除后标题仍在，
   * 配合 refMissing 标记呈现"源已删除"。
   */
  title: string;
  note?: string | undefined;
  /** 预估专注分钟数；free 项常用 */
  estimateMinutes?: number | undefined;
  done: boolean;
  /** 引用源是否已被删除（软删/硬删后置位，日项本体保留 —— 历史诚实性） */
  refMissing?: boolean | undefined;
}

/** 一天的计划。dateKey 是业务键（锚点时区钟表日），id 由它确定性派生 */
export interface DailyPlan extends Timestamped {
  id: DailyPlanId;
  dateKey: string;
  items: DailyPlanItem[];
}

/** 日计划的确定性 id：一天一条，重复调用 getOrCreate 幂等 */
export function dailyPlanIdOf(dateKey: string): DailyPlanId {
  return `daily-${dateKey}`;
}

/** 新条目的 id（确定性 + 时间戳，冲突概率与全局实体一致） */
export function newItemId(now: number): string {
  return `dpi_${now.toString(36)}_${dailyItemSeq++}`;
}
let dailyItemSeq = 0;

/** 完成统计（总览卡 / AI 播报共用口径） */
export function dailyProgress(items: readonly DailyPlanItem[]): {
  total: number;
  done: number;
  ratio: number | null;
} {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return {
    total,
    done,
    ratio: total === 0 ? null : Math.round((done / total) * 100),
  };
}
