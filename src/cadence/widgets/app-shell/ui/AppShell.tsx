/**
 * 应用外壳（布局骨架）
 *
 * 职责边界：只负责"把内容放到正确的位置 + 页面转场"。
 * 不认识路由（routeKey / direction 由 app 层传入），也不认识业务模块。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import { CalendarDays, Menu, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/cadence/data/db/database";
import { sessionDurationMs } from "@/cadence/entities/session";
import { SyncStatusBar } from "@/cadence/sync/SyncPanel";
import { NAV_ITEMS } from "../model/nav-config";

import { MotionRoute, type TransitionDirection } from "@/cadence/shared/motion";
import { ToastHost } from "@/cadence/shared/ui/ToastHost";

function FocusIndicator() {
  const active = useLiveQuery(
    async () =>
      (await db.sessions.toArray()).find((s) => s.endedAt === undefined),
    [],
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const seconds = Math.floor(sessionDurationMs(active, now) / 1000);
  return (
    <Link
      to="/execute"
      data-m3-role="button"
      data-m3-variant="tonal"
      className="rounded-md border border-border px-3 py-2 text-sm text-primary"
    >
      {active.pausedAt === undefined ? "执行中" : "已暂停"} ·{" "}
      <span className="numeric">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
    </Link>
  );
}

interface AppShellProps {
  /** 路由标识，变化即触发转场 */
  routeKey: string;
  direction?: TransitionDirection;
  children: ReactNode;
}

export function AppShell({
  routeKey,
  direction = "lateral",
  children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [routeKey]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const navigation = (
    <nav data-m3-role="module-navigation" aria-label="日程模块" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <Link
          data-m3-role="navigation-item"
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          onClick={() => setMenuOpen(false)}
          className="flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          activeProps={{ className: "bg-accent text-foreground", "aria-current": "page" }}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="cadence-shell mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
      <header data-m3-role="page-header" className="neo-schedule-heading mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="neo-schedule-eyebrow">MY TIME / 时间手账</p>
          <h1 className="font-display text-2xl">日程 <CalendarDays size={27} aria-hidden="true" /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            安排时间，记录投入，回看每一天。
          </p>
        </div>
        <div className="neo-schedule-heading-actions"><FocusIndicator /><div className="neo-schedule-sticker"><img src="/images/neobrutalism/cat-peek.webp" width="78" height="62" alt="" aria-hidden="true" /><p>认真生活<br />把热爱排进每一天</p></div></div>
      </header>
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Trigger asChild>
          <button data-m3-role="button" data-m3-variant="outlined" type="button" className="mb-3 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm lg:hidden">
            <Menu size={16} aria-hidden="true" />日程菜单
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay data-m3-role="scrim" className="fixed inset-0 z-[5100] bg-black/40" />
          <Dialog.Content data-m3-role="sheet" aria-describedby={undefined} className="cadence-root neo-schedule-menu fixed inset-y-0 left-0 z-[5101] w-[min(280px,85vw)] overflow-y-auto border-r border-border bg-background p-5 shadow-lg">
            <div className="mb-5 flex items-center justify-between">
              <Dialog.Title className="font-display text-lg">日程菜单</Dialog.Title>
              <Dialog.Close asChild>
                <button data-m3-role="icon-button" type="button" aria-label="关闭日程菜单" className="rounded-md p-2"><X size={18} /></button>
              </Dialog.Close>
            </div>
            {navigation}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="cadence-shell-layout">
        <aside className="cadence-sidebar hidden lg:block"><p className="neo-schedule-nav-label">时间手账 <small>TIME JOURNAL</small></p>{navigation}<p className="neo-schedule-nav-note">一步一步，慢慢完成。</p></aside>
        <div className="min-w-0">
          <SyncStatusBar />
          <div className="neo-schedule-content min-w-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="w-full pt-3 pb-10">
              <MotionRoute routeKey={routeKey} direction={direction}>
                {children}
              </MotionRoute>
            </div>
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
