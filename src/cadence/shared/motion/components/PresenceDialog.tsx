/**
 * 模态框（L3 模式层）
 * ---------------------------------------------------------------------------
 * 分工：**Radix 负责无障碍，我们负责动画**。
 *   Radix 提供：焦点陷阱、Esc 关闭、焦点归还、aria-modal、滚动锁定、层级管理
 *   我们提供：backdrop / modalPanel 两个手作变体 + AnimatePresence 退出动画
 *
 * 实现要点：Radix 的退出动画需要 `forceMount` —— 否则 Radix 会在 open 变 false
 * 的同一帧把节点卸载，AnimatePresence 拿不到退出时机，动画直接不播。
 *
 * 模态上限：同时打开不超过 2 层（产品约束）。第 3 层应替换第 2 层，
 * 避免层级混乱、用户不知道自己在哪。
 *
 * 职责边界：本文件只提供"容器"。确认框这类具体组合见
 * shared/ui/ConfirmDialog.tsx —— 避免 shared/motion 反向依赖 shared/ui 造成循环。
 */

import { Dialog as RadixDialog } from "radix-ui";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import {
  AnimatePresence,
  backdrop,
  m,
  modalPanel,
} from "@/cadence/shared/motion";
import { useResolvedVariants } from "@/cadence/shared/motion";

type DialogSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

interface PresenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 标题：Radix 用它生成 aria-labelledby，必填 */
  title: ReactNode;
  /** 描述：给屏幕阅读器的补充说明 */
  description?: ReactNode;
  children?: ReactNode;
  /** 底部操作区（按钮组） */
  footer?: ReactNode;
  size?: DialogSize;
}

export function PresenceDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: PresenceDialogProps) {
  const backdropVariants = useResolvedVariants(backdrop);
  const panelVariants = useResolvedVariants(modalPanel);
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
                className="fixed inset-0 z-[var(--z-modal)] bg-[var(--scrim)]"
              />
            </RadixDialog.Overlay>

            {/* 未提供 description 时显式声明"没有描述"，
             * 否则 Radix 会在开发期反复警告缺少 aria-describedby */}
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
                data-m3-role="dialog"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{ borderRadius: "var(--radius-hand-lg)" }}
                className={[
                  "surface-card fixed top-1/2 left-1/2 z-[var(--z-modal)] -translate-x-1/2 -translate-y-1/2",
                  "max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto p-6",
                  SIZE_CLASS[size],
                ].join(" ")}
              >
                <RadixDialog.Title className="text-ink-1 font-serif text-lg">
                  {title}
                </RadixDialog.Title>

                {description ? (
                  <RadixDialog.Description className="text-ink-3 mt-1.5 text-[12.5px]">
                    {description}
                  </RadixDialog.Description>
                ) : null}

                {children ? <div className="mt-4">{children}</div> : null}
                {footer ? (
                  <div className="mt-6 flex justify-end gap-3">{footer}</div>
                ) : null}

                {/* 关闭按钮：手绘小叉 */}
                <RadixDialog.Close
                  data-m3-role="icon-button"
                  aria-label="关闭"
                  className="text-ink-3 hover:text-ink-1 craft-transition-fast absolute top-4 right-4 grid h-7 w-7 place-items-center rounded-full"
                >
                  <X size={17} aria-hidden="true" />
                </RadixDialog.Close>
              </m.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
