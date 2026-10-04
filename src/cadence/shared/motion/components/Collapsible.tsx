/**
 * 展开收起（L3 模式层）
 * ---------------------------------------------------------------------------
 * 手作化处理：用 unwrap（"展开一张卷起的纸"），带 -0.8° 的旋转与过冲，
 * 而不是通用 UI 那种纯高度变化。
 *
 * 无障碍：用 Radix Collapsible 承载语义（aria-expanded / aria-controls /
 * data-state），动画完全由我们控制 —— 用 forceMount 关掉 Radix 自己的显隐，
 * 交给 AnimatePresence。
 *
 * ♿ reduced-motion 下退化为瞬时切换：高度动画是最容易引发前庭不适的一类
 *    （04 号文档 §7.1 明确规定）。
 */

import { Collapsible as RadixCollapsible } from "radix-ui";
import type { ReactNode } from "react";

import { AnimatePresence, m, unwrap } from "@/cadence/shared/motion";
import { useResolvedVariants } from "@/cadence/shared/motion";

interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 触发器内容；Radix 会自动补上 aria-expanded / aria-controls */
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function Collapsible({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  contentClassName,
}: CollapsibleProps) {
  const variants = useResolvedVariants(unwrap);

  return (
    <RadixCollapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      <RadixCollapsible.Trigger asChild>{trigger}</RadixCollapsible.Trigger>

      <AnimatePresence initial={false}>
        {open ? (
          <RadixCollapsible.Content asChild forceMount>
            <m.div
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ transformOrigin: "top center" }}
              // 高度动画必须裁剪溢出，否则内容会在收起过程中溢出到下方元素之上
              className={["overflow-hidden", contentClassName]
                .filter(Boolean)
                .join(" ")}
            >
              {children}
            </m.div>
          </RadixCollapsible.Content>
        ) : null}
      </AnimatePresence>
    </RadixCollapsible.Root>
  );
}
