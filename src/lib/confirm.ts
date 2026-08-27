/**
 * 全局确认弹框（替换浏览器原生 window.confirm）
 *
 * - 动态创建 <dialog>，居中显示，样式跟随站点主题令牌；
 * - 用法：`if (!(await confirmDialog('确定删除？'))) return;`
 * - 支持自定义确认按钮文案 / 危险操作（红色确认按钮）；
 * - 幂等：重复调用会复用已创建的 dialog 节点；View Transition 后
 *   document 不销毁，dialog 节点挂在 body 上持续有效。
 */

export interface ConfirmOptions {
  /** 标题（默认"请确认"） */
  title?: string;
  /** 确认按钮文案（默认"确定"） */
  confirmText?: string;
  /** 取消按钮文案（默认"取消"） */
  cancelText?: string;
  /** 危险操作：确认按钮用红色（删除类操作） */
  danger?: boolean;
}

let dialogEl: HTMLDialogElement | null = null;
let titleEl: HTMLElement | null = null;
let messageEl: HTMLElement | null = null;
let confirmBtn: HTMLButtonElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;

/** 确保弹框 DOM 已创建（惰性） */
function ensureDialog(): boolean {
  if (dialogEl && dialogEl.isConnected) return true;
  dialogEl = document.createElement('dialog');
  dialogEl.className = 'm-auto w-80 rounded-lg border border-border bg-card p-4 shadow-xl backdrop:bg-black/40';
  dialogEl.innerHTML = `
    <h3 data-confirm-title class="text-sm font-medium"></h3>
    <p data-confirm-message class="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words"></p>
    <div class="mt-4 flex items-center justify-end gap-2">
      <button data-confirm-cancel type="button" class="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"></button>
      <button data-confirm-ok type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90"></button>
    </div>
  `;
  titleEl = dialogEl.querySelector('[data-confirm-title]');
  messageEl = dialogEl.querySelector('[data-confirm-message]');
  confirmBtn = dialogEl.querySelector('[data-confirm-ok]');
  cancelBtn = dialogEl.querySelector('[data-confirm-cancel]');
  document.body.appendChild(dialogEl);
  return true;
}

/**
 * 显示确认弹框
 * @param message 提示内容（支持 \n 换行）
 * @param options 可选配置
 * @returns 用户点击确认 → true；取消 / Esc / 点击遮罩 → false
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (!ensureDialog() || !dialogEl || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
    // 兜底：DOM 异常时退回原生 confirm，保证功能可用
    return Promise.resolve(window.confirm(message));
  }

  titleEl.textContent = options.title ?? '请确认';
  messageEl.textContent = message;
  confirmBtn.textContent = options.confirmText ?? '确定';
  cancelBtn.textContent = options.cancelText ?? '取消';
  // 危险操作：确认按钮换红色
  confirmBtn.className = options.danger
    ? 'rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-opacity hover:opacity-90'
    : 'rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90';

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      dialogEl?.close();
      confirmBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      dialogEl?.removeEventListener('cancel', onCancel);
      dialogEl?.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = (): void => finish(true);
    const onCancel = (): void => finish(false);
    // 点击遮罩（dialog 外部区域）→ 取消
    const onBackdrop = (e: MouseEvent): void => {
      const rect = dialogEl!.getBoundingClientRect();
      const inDialog = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inDialog) finish(false);
    };
    confirmBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    dialogEl?.addEventListener('cancel', onCancel); // Esc
    dialogEl?.addEventListener('click', onBackdrop);
    dialogEl?.showModal();
  });
}

/** 便捷方法：危险确认（删除类），确认按钮为红色 */
export function confirmDanger(message: string, options: Omit<ConfirmOptions, 'danger'> = {}): Promise<boolean> {
  return confirmDialog(message, { ...options, danger: true, confirmText: options.confirmText ?? '删除' });
}
