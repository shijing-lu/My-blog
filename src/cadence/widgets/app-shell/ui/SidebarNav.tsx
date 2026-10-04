/**
 * 桌面端侧边栏导航
 *
 * 设计取向：这是一张**贴在案台左侧的索引纸**，不是"应用导航栏"。
 * 因此不投阴影（与内容纸面同属一张纸）、右侧用一条手绘分隔线收边。
 *
 * 可折叠：折叠后只留图标列（64px），看板区随之铺满。
 * 折叠状态持久化到 localStorage（shell-store），刷新不跳变。
 *
 * 左下角常驻专注条：有进行中的专注时显示实时时长 + 结束入口。
 * 刻意**不在侧栏直接结束** —— 结束动作会触发复盘弹窗，
 * 那是在执行页完成的工作流，这里只负责"看得见"与"跳过去"。
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, Timer } from "lucide-react";

import { HandRule } from "@/cadence/shared/motion";
import { isSessionActive, sessionDurationMs } from "@/cadence/entities/session";
import {
  dateKeyOf,
  endOfDayMs,
  formatDuration,
  localTzOffsetMinutes,
  startOfDayMs,
  DAY_MS,
} from "@/cadence/shared/db/time";
import { db } from "@/cadence/data/db/database";
import {
  useSidebarCollapsed,
  useShellStore,
} from "@/cadence/shared/store/shell-store";
import { pigmentClasses } from "@/cadence/shared/ui/pigment-classes";

import { NAV_ITEMS } from "../model/nav-config";

/** 今日已投入时长（已结束会话之和）。每分钟重查足够 —— 它只是氛围数字 */
function useTodayInvested(): number {
  const tz = useMemo(() => localTzOffsetMinutes(), []);
  return (
    useLiveQuery(async () => {
      const key = dateKeyOf(Date.now(), tz);
      const list = await db.sessions
        .where("startedAt")
        .between(startOfDayMs(key, tz) - 2 * DAY_MS, endOfDayMs(key, tz))
        .toArray();
      const now = Date.now();
      return list
        .filter(
          (session) =>
            !isSessionActive(session) && session.endedAt !== undefined,
        )
        .reduce((sum, session) => sum + sessionDurationMs(session, now), 0);
    }, [tz]) ?? 0
  );
}

/**
 * 常驻专注条：有进行中的专注时出现在侧栏底部。
 * 心跳 1s 只驱动这一个组件（时长数字），不触碰导航与今日累计。
 */
function ActiveSessionBar({ collapsed }: { collapsed: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  // 与执行页同款确定性范围：Dexie liveQuery 只观察首次执行时的键区间
  const active = useLiveQuery(async () => {
    const tz = localTzOffsetMinutes();
    const key = dateKeyOf(Date.now(), tz);
    const list = await db.sessions
      .where("startedAt")
      .between(startOfDayMs(key, tz) - 2 * DAY_MS, endOfDayMs(key, tz) + DAY_MS)
      .toArray();
    return list.find(isSessionActive);
  }, []);

  useEffect(() => {
    if (active === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (active === undefined) return null;

  if (collapsed) {
    return (
      <Link
        to="/execute"
        title={`专注中 ${formatDuration(sessionDurationMs(active, now))} · 点击去结束`}
        aria-label={`专注中，已进行 ${formatDuration(sessionDurationMs(active, now))}`}
        className="craft-transition-fast flex items-center justify-center gap-1.5 rounded-[var(--radius-hand-pill)] bg-amber-soft py-2 text-amber-deep"
      >
        <Timer size={14} aria-hidden="true" />
        <span className="numeric text-[10.5px]">
          {formatDuration(sessionDurationMs(active, now))}
        </span>
      </Link>
    );
  }

  return (
    <Link
      to="/execute"
      className="craft-transition-fast bg-amber-soft hover:bg-amber-base/30 block rounded-[var(--radius-hand-sm)] px-3 py-2.5"
    >
      <p className="text-amber-deep flex items-center gap-1.5 text-[11px] tracking-[0.14em]">
        <Timer size={13} aria-hidden="true" />
        专注中
      </p>
      <p className="text-ink-1 numeric mt-1 font-serif text-[17px] leading-none">
        {formatDuration(sessionDurationMs(active, now))}
      </p>
      <p className="text-ink-3 mt-1 text-[10.5px]">点击去结束 →</p>
    </Link>
  );
}

export function SidebarNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const collapsed = useSidebarCollapsed();
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const invested = useTodayInvested();

  return (
    <aside
      className={[
        "surface-inset relative hidden shrink-0 md:flex md:flex-col",
        "craft-transition-[width] [transition-duration:var(--dur-slow)] [transition-timing-function:var(--ease-standard)]",
        collapsed ? "w-16" : "w-[228px]",
      ].join(" ")}
    >
      {/* 品牌区：像在纸角写下的名字 */}
      <div
        className={[
          "pb-5",
          collapsed ? "px-3 pt-6 text-center" : "px-6 pt-7",
        ].join(" ")}
      >
        {collapsed ? (
          <h1 className="text-ink-1 font-serif text-[17px] leading-none">节</h1>
        ) : (
          <>
            <h1 className="text-[19px] leading-none tracking-[0.06em]">
              Cadence
            </h1>
            <p className="text-ink-3 mt-1.5 text-[11px] tracking-[0.28em]">
              节 律
            </p>
            <HandRule shape="wave" tone="mark" className="mt-3.5" />
          </>
        )}
      </div>

      {/*
       * aria-label 必须放在 <nav> 上，不能放在 <aside> 上。
       * <aside> 的隐式 role 是 complementary，不是 navigation ——
       * 放在 aside 上会让 getByRole('navigation') 完全匹配不到。
       */}
      <nav
        aria-label="主导航"
        className={["flex-1", collapsed ? "px-2" : "px-3.5"].join(" ")}
      >
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.to ||
              (item.to !== "/" && pathname.startsWith(item.to));
            const Icon = item.icon;
            const tone = pigmentClasses(item.pigment);

            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  // 折叠态只剩图标（aria-hidden），可访问名要显式给
                  aria-label={collapsed ? item.label : undefined}
                  className={[
                    "craft-transition-fast group relative flex items-center gap-3 rounded-[var(--radius-hand-sm)] text-[13.5px]",
                    collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                    active
                      ? "bg-paper-1 text-ink-1 shadow-[inset_0_1px_0_0_rgb(255_255_255/50%),0_1px_2px_-1px_var(--paper-shadow)]"
                      : "text-ink-3 hover:bg-paper-1/60 hover:text-ink-2",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "craft-transition-fast h-1.5 w-1.5 shrink-0 rounded-full",
                      collapsed ? "absolute left-2 top-2" : "",
                      active ? tone.dot : "bg-paper-line group-hover:bg-ink-4",
                    ].join(" ")}
                  />
                  <Icon
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  {collapsed ? null : (
                    <span className="font-medium">{item.label}</span>
                  )}
                  {!collapsed && active ? (
                    <span className="text-ink-4 ml-auto text-[10.5px] tracking-wide">
                      {item.hint}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 底部：常驻专注条 + 今日投入摘要 + 折叠开关 */}
      <div className={["pt-4 pb-5", collapsed ? "px-2" : "px-4"].join(" ")}>
        <HandRule shape="ripple" className="mb-3" />

        <div className="space-y-2.5">
          <ActiveSessionBar collapsed={collapsed} />
          {collapsed ? (
            <p
              className="text-ink-4 numeric text-center text-[10px]"
              title="今日已投入"
            >
              {formatDuration(invested)}
            </p>
          ) : (
            <p className="text-ink-4 text-[11px] leading-relaxed">
              今日已投入
              <br />
              <span className="text-ink-2 numeric">
                {formatDuration(invested)}
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-pressed={collapsed}
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className={[
            "text-ink-4 hover:text-ink-2 craft-transition-fast mt-3 flex items-center gap-1.5 rounded-[var(--radius-hand-sm)] py-1.5 text-[11px]",
            collapsed ? "justify-center px-0" : "px-2",
          ].join(" ")}
        >
          {collapsed ? (
            <ChevronsRight size={14} aria-hidden="true" />
          ) : (
            <>
              <ChevronsLeft size={14} aria-hidden="true" />
              折叠
            </>
          )}
        </button>
      </div>

      {/* 右侧手绘收边 */}
      <span
        aria-hidden="true"
        className="bg-paper-line absolute inset-y-0 right-0 w-px"
      />
    </aside>
  );
}
