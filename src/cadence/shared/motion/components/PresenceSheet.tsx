/**
 * 抽屉 / 底部面板（L3 模式层）
 * ---------------------------------------------------------------------------
 * 同一个组件按视口自动切换方向：
 *   宽屏   —— 从右侧滑入的抽屉（drawerRight）
 *   窄屏   —— 从底部升起的面板（sheetBottom）
 *
 * 为什么不做成两个组件：调用方（如"筛选条件"）不该关心当前是哪种设备，
 * 也不该为此写两套代码。切换方向是布局细节，不是业务决策。
 *
 * 无障碍与 PresenceDialog 一致：Radix 负责焦点与 Esc，我们负责动画。
 */

import { Dialog as RadixDialog } from "radix-ui";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { useIsMobile } from "@/cadence/shared/lib/media-query";
import {
  AnimatePresence,
  backdrop,
  drawerRight,
  m,
  sheetBottom,
} from "@/cadence/shared/motion";
import { useResolvedVariants } from "@/cadence/shared/motion";

interface PresenceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 底部操作区 */
  footer?: ReactNode;
}

/** 宽屏抽屉宽度；窄屏面板最大高度（都用 dvh 以避开移动端地址栏抖动） */
const DRAWER_WIDTH = "min(420px, 92vw)";
const SHEET_MAX_HEIGHT = "88dvh";

export function PresenceSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: PresenceSheetProps) {
  const isMobile = useIsMobile();
  const backdropVariants = useResolvedVariants(backdrop);
  const panelVariants = useResolvedVariants(
    isMobile ? sheetBottom : drawerRight,
  );
  const opener = useRef<HTMLElement | null>(null);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal
            forceMount
            container={document.querySelector<HTMLElement>(".cadence-root")}
          >
            <RadixDialog.Overlay asChild forceMount>
              <m.div
                data-m3-role="scrim"
                variants={backdropVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="fixed inset-0 z-[var(--z-drawer)] bg-[var(--scrim)]"
              />
            </RadixDialog.Overlay>

            <RadixDialog.Content
              asChild
              forceMount
              onOpenAutoFocus={() => {
                opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              }}
              onCloseAutoFocus={(event) => {
                if (opener.current?.isConnected) {
                  event.preventDefault();
                  opener.current.focus({ preventScroll: true });
                }
              }}
              {...(description ? {} : { "aria-describedby": undefined })}
            >
              <m.div
                data-m3-role="sheet"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={
                  isMobile
                    ? {
                        maxHeight: SHEET_MAX_HEIGHT,
                        width: "100%",
                        borderTopLeftRadius: "var(--radius-hand-lg)",
                        borderTopRightRadius: "var(--radius-hand-lg)",
                      }
                    : { width: DRAWER_WIDTH }
                }
                className={[
                  "surface-paper fixed z-[var(--z-drawer)] flex flex-col overflow-y-auto p-6",
                  isMobile
                    ? "inset-x-0 bottom-0 shadow-[0_-8px_24px_-16px_var(--paper-shadow-strong)]"
                    : "inset-y-0 right-0 shadow-[-8px_0_24px_-16px_var(--paper-shadow-strong)]",
                ].join(" ")}
              >
                {/* 移动端顶部留一条"捏手"横线，暗示可下拉关闭 */}
                {isMobile ? (
                  <span
                    aria-hidden="true"
                    className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-paper-line"
                  />
                ) : null}

                <div className="flex items-baseline justify-between gap-3">
                  <RadixDialog.Title className="text-ink-1 font-serif text-lg">
                    {title}
                  </RadixDialog.Title>
                  <RadixDialog.Close
                    data-m3-role="icon-button"
                    aria-label="关闭"
                    className="text-ink-3 hover:text-ink-1 craft-transition-fast grid h-7 w-7 shrink-0 place-items-center rounded-full"
                  >
                    <X size={17} aria-hidden="true" />
                  </RadixDialog.Close>
                </div>

                {description ? (
                  <RadixDialog.Description className="text-ink-3 mt-1.5 text-[12.5px]">
                    {description}
                  </RadixDialog.Description>
                ) : null}

                {children ? (
                  <div className="mt-4 flex-1">{children}</div>
                ) : null}
                {footer ? (
                  <div className="mt-6 flex justify-end gap-3">{footer}</div>
                ) : null}
              </m.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
