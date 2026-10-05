/**
 * 移动端底部 Tab
 *
 * 与桌面侧边栏共用 NAV_ITEMS，但只显示图标 + 极短标签 ——
 * 移动端 6 个 Tab 已是宽度上限，不能带 hint。
 *
 * 安全区：使用 env(safe-area-inset-bottom) 避开手势条（NFR-PORT-04）。
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

import { pigmentClasses } from "@/cadence/shared/ui/pigment-classes";

import { NAV_ITEMS } from "../model/nav-config";

export function BottomTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      data-m3-role="module-navigation"
      aria-label="主导航"
      className="surface-paper fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-paper-line md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.to ||
            (item.to !== "/" && pathname.startsWith(item.to));
          const Icon = item.icon;
          const tone = pigmentClasses(item.pigment);

          return (
            <li key={item.to} className="flex-1">
              <Link
                data-m3-role="navigation-item"
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 text-[10.5px]",
                  active ? "text-ink-1" : "text-ink-3",
                ].join(" ")}
              >
                <MaterialIcon name={item.materialIcon}><Icon
                  size={19}
                  strokeWidth={active ? 2.1 : 1.7}
                  aria-hidden="true"
                /></MaterialIcon>
                <span>{item.label}</span>
                {/* 选中指示：一条手绘感的短横线，而非整块高亮 */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className={[
                      "absolute top-0 h-[2.5px] w-7 rounded-full",
                      tone.dot,
                    ].join(" ")}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
