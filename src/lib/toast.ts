/**
 * 轻量 Toast（补齐项目此前缺失的"统一反馈层"）
 *
 * 为什么自己写而不引库：需求只有"操作成功/失败提示"一种，20 行足够；
 * 且需要与项目既有的动效令牌、View Transitions 生命周期保持一致。
 *
 * 特点：
 * - 单容器 + 单例（多次调用排队展示，不叠满屏）；
 * - 进出场用令牌时长；`prefers-reduced-motion` 下直接显示；
 * - 容器带 `view-transition-name: none`（见 tokens-motion.css），不会被页面转场重复快照。
 */

type ToastKind = 'success' | 'error' | 'info';

const HOST_ID = 'byqx-toast-host';
let hostEl: HTMLElement | null = null;
let hideTimer: number | null = null;

function ensureHost(): HTMLElement {
  if (hostEl && document.body.contains(hostEl)) return hostEl;
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.className = 'byqx-toast-host';
  document.body.appendChild(el);
  hostEl = el;
  return el;
}

/** 显示一条提示（同屏只保留最近一条，避免堆叠干扰） */
export function toast(message: string, kind: ToastKind = 'success', durationMs = 2400): void {
  if (typeof document === 'undefined' || !message) return;
  const host = ensureHost();

  // 已有提示：直接替换内容（交叉淡化观感比排队更利落）
  host.querySelectorAll('.byqx-toast').forEach((n) => n.remove());
  if (hideTimer !== null) window.clearTimeout(hideTimer);

  const item = document.createElement('div');
  item.className = `byqx-toast byqx-toast--${kind}`;
  item.textContent = message;
  host.appendChild(item);

  hideTimer = window.setTimeout(() => {
    item.classList.add('byqx-toast--out');
    const remove = (): void => item.remove();
    item.addEventListener('animationend', remove, { once: true });
    // 兜底（reduced-motion 下没有动画事件）
    window.setTimeout(remove, 400);
  }, durationMs);
}

/** 语法糖 */
export const toastSuccess = (m: string): void => toast(m, 'success');
export const toastError = (m: string): void => toast(m, 'error');
