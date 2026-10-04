/**
 * 轻提示状态（Toast）
 *
 * 放在 store 而不是 Context：Toast 的调用点散布在各处（hooks、usecase 回调、
 * 错误边界），Context 需要组件树可达；store 让任何地方（含非组件代码）
 * 都能直接 `toast.error('...')`。
 */

import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  /** 可选操作按钮（如"撤销"） */
  action?: { label: string; onClick: () => void };
  /** 自动消失时长（ms）；0 表示不自动消失 */
  duration: number;
}

interface ToastState {
  items: ToastItem[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** duration 可省略；显式传 0 表示"不自动消失" */
export interface ToastInput {
  tone: ToastTone;
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

const DEFAULT_DURATION = 4200;
/** 同时最多 3 条 —— 再多会遮挡内容，且移动端会盖住底部导航 */
const MAX_VISIBLE = 3;

let seq = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  items: [],

  push: (input) => {
    seq += 1;
    const id = `toast-${seq}`;
    const item: ToastItem = {
      id,
      tone: input.tone,
      message: input.message,
      // 用 ?? 而不是 ||：显式传 0 表示"不自动消失"，|| 会把它换成默认值
      duration: input.duration ?? DEFAULT_DURATION,
      ...(input.action ? { action: input.action } : {}),
    };
    // 超出上限时移除最早的，而不是拒绝新的 —— 最新反馈通常最重要
    set({ items: [...get().items, item].slice(-MAX_VISIBLE) });
    return id;
  },

  dismiss: (id) =>
    set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set({ items: [] }),
}));

/**
 * 命令式 API
 * 调用方可以是组件，也可以是 usecase / 错误边界等非组件代码。
 */
export const toast = {
  info: (message: string) =>
    useToastStore.getState().push({ tone: "info", message }),
  success: (message: string) =>
    useToastStore.getState().push({ tone: "success", message }),
  warning: (message: string) =>
    useToastStore.getState().push({ tone: "warning", message }),
  error: (message: string) =>
    useToastStore.getState().push({ tone: "danger", message }),
  /**
   * 带撤销的提示
   * 时长延长到 8 秒 —— 给用户留出反应与点击的时间，
   * 否则"撤销"按钮形同虚设（默认 4.2 秒对"看清文案 + 决定 + 点击"太紧）。
   */
  undoable: (message: string, onUndo: () => void) =>
    useToastStore.getState().push({
      tone: "info",
      message,
      duration: 8000,
      action: { label: "撤销", onClick: onUndo },
    }),
  /** 常驻提示（不自动消失），需要用户显式处理 */
  sticky: (message: string, tone: ToastTone = "warning") =>
    useToastStore.getState().push({ tone, message, duration: 0 }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
