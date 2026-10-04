/**
 * 轻提示宿主（无业务基础组件）
 * ---------------------------------------------------------------------------
 * 挂在 AppShell 里，全站只需一个。
 *
 * 位置：桌面右下、移动端顶部 —— 移动端右下会与底部 Tab 与手势条打架。
 *
 * 手作化处理：用 `toast` 变体（从下方升起 + 轻缩放），像一张被递过来的便签。
 * 动画用 `mode="popLayout"`：多条同时消失时，其余条目立即让位而不是抽动。
 */

import { useEffect, type ReactNode } from "react";

import {
  AnimatePresence,
  m,
  toast as toastVariants,
  useResolvedVariants,
} from "@/cadence/shared/motion";
import {
  useToastStore,
  type ToastItem,
  type ToastTone,
} from "@/cadence/shared/store/toast-store";

const TONE_CLASS: Record<ToastTone, string> = {
  info: "bg-craft-soft text-craft-deep",
  success: "bg-forest-soft text-forest-deep",
  warning: "bg-ochre-soft text-ochre-deep",
  danger: "bg-clay-soft text-clay-deep",
};

const TONE_MARK: Record<ToastTone, string> = {
  info: "bg-craft-base",
  success: "bg-forest-base",
  warning: "bg-ochre-base",
  danger: "bg-clay-base",
};

/** 单条提示：自己管理自动消失的定时器 */
function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const variants = useResolvedVariants(toastVariants);

  useEffect(() => {
    // duration 为 0 表示常驻，需要用户显式处理
    if (item.duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.duration, item.id, dismiss]);

  return (
    <m.div
      layout="position"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="status"
      aria-live={item.tone === "danger" ? "assertive" : "polite"}
      className="surface-card flex max-w-sm items-start gap-3 px-4 py-3"
      style={{ borderRadius: "var(--radius-hand-md)" }}
    >
      {/* 左侧色条：颜色只是强化，语义同时由文字承载 */}
      <span
        aria-hidden="true"
        className={[
          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
          TONE_MARK[item.tone],
        ].join(" ")}
      />

      <p
        className={[
          "flex-1 text-[13px] leading-snug",
          TONE_CLASS[item.tone],
        ].join(" ")}
      >
        {item.message}
      </p>

      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            dismiss(item.id);
          }}
          className="craft-transition-fast text-ink-1 hover:text-amber-deep -my-1 shrink-0 rounded-[var(--radius-hand-sm)] px-2 py-1 text-[12.5px] font-medium underline"
        >
          {item.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="关闭提示"
        className="text-ink-4 hover:text-ink-2 craft-transition-fast -my-1 -mr-1 shrink-0 rounded-full p-1"
      >
        <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true">
          <path
            d="M2.4 2.2 L9.7 9.6 M9.4 2.5 L2.3 9.4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </svg>
      </button>
    </m.div>
  );
}

export function ToastHost(): ReactNode {
  const items = useToastStore((state) => state.items);

  return (
    <div
      aria-label="通知"
      className="pointer-events-none fixed inset-x-3 top-3 z-[var(--z-toast)] flex flex-col items-center gap-2 md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:items-end"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item) => (
          <div key={item.id} className="pointer-events-auto w-full md:w-auto">
            <ToastRow item={item} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
