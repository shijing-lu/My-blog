/**
 * 一级导航配置
 *
 * 顺序即用户的时间动线：先看今天（总览）→ 制定（计划）→ 执行 → 反思（复盘）→ 收集（待办）。
 * 每个条目绑定一个颜料语义色（docs/05-…规范 §2.8），
 * 让用户在导航上就能建立"颜色 = 我在做什么"的联系。
 */

import {
  CalendarRange,
  Feather,
  LayoutDashboard,
  NotebookPen,
  BarChart3,
  Settings,
  StickyNote,
  Timer,
  type LucideIcon,
} from "lucide-react";

import type { PigmentKey } from "@/cadence/shared/config/pigment";

export interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** 该模块的语义色 */
  pigment: PigmentKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/",
    label: "总览",
    hint: "今天的状态",
    icon: LayoutDashboard,
    pigment: "archive",
  },
  {
    to: "/plans",
    label: "计划",
    hint: "要做什么",
    icon: NotebookPen,
    pigment: "plan",
  },
  {
    to: "/schedule",
    label: "日程",
    hint: "时间块",
    icon: CalendarRange,
    pigment: "session",
  },
  {
    to: "/execute",
    label: "执行",
    hint: "实际投入",
    icon: Timer,
    pigment: "session",
  },
  {
    to: "/review",
    label: "复盘",
    hint: "按小时回看",
    icon: Feather,
    pigment: "review",
  },
  {
    to: "/todos",
    label: "待办",
    hint: "待处理的事",
    icon: StickyNote,
    pigment: "todo",
  },
  {
    to: "/stats",
    label: "统计",
    hint: "投入与节律",
    icon: BarChart3,
    pigment: "review",
  },
  {
    to: "/settings",
    label: "设置",
    hint: "外观与数据",
    icon: Settings,
    pigment: "archive",
  },
] as const;
