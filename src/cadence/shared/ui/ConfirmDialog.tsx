/**
 * 确认对话框（无业务基础组件）
 *
 * 存在的意义：把手作风格的按钮与 PresenceDialog 组合成"危险操作"的标准形态，
 * 避免每个删除入口都手写一套按钮与文案结构。
 *
 * 危险操作仍用陶土色（与"紧迫"共色相），但取 deep 档保证对比度 ≥ 4.5:1。
 */

import type { ReactNode } from "react";

import { PresenceDialog } from "@/cadence/shared/motion";

import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 正文内容，用于展示"将影响哪些数据" */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮转为陶土色 */
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <PresenceDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </PresenceDialog>
  );
}
