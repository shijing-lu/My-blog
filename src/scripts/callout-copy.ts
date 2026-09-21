/**
 * Callout（阅读模式引用块）复制按钮 —— 原生 JS，无依赖
 *
 * - 数据来源：remarkCallout 在编译期把整块 markdown 源码（含 `> [!type]` 标记、
 *   嵌套引用与内嵌代码块）经 MDX 属性传给 Callout.tsx，最终落在按钮的
 *   `data-callout-source` 属性上；本脚本点击时直接取用，无需从 DOM 反推；
 * - 与 copy-button / tabs / lightbox 同一模式：**document 级事件委托**，
 *   View Transitions 转场、文档页前端即时切换重注入 HTML 后均无需重绑；
 * - 反馈：成功 → 对勾 + .copied 高亮；失败 → ✕ + .copy-failed 抖动
 *   （样式与代码块复制按钮同一视觉语言，见 global.css .callout .callout-copy）。
 */
import { copyText } from './copy-button';

/** 反馈时长（ms） */
const FLASH_MS = 1400;

/** 待复位定时器：按按钮归集（同按钮旧定时器先取消，连点不互相抹除） */
const resetTimers = new WeakMap<HTMLButtonElement, number>();

function scheduleReset(btn: HTMLButtonElement, fn: () => void): void {
  const prev = resetTimers.get(btn);
  if (prev !== undefined) window.clearTimeout(prev);
  resetTimers.set(
    btn,
    window.setTimeout(() => {
      resetTimers.delete(btn);
      fn();
    }, FLASH_MS),
  );
}

/** 切换按钮内三枚图标（copy 默认 / check 成功 / error 失败） */
function setIcon(btn: HTMLButtonElement, name: 'copy' | 'check' | 'error'): void {
  btn.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.classList.toggle('hidden', el.getAttribute('data-icon') !== name);
  });
}

/** 复制成功：图标切到对勾并主色高亮 */
function flash(btn: HTMLButtonElement): void {
  setIcon(btn, 'check');
  btn.classList.add('copied');
  scheduleReset(btn, () => {
    setIcon(btn, 'copy');
    btn.classList.remove('copied');
  });
}

/** 复制失败：✕ + 抖动提示（不再静默吞掉） */
function flashError(btn: HTMLButtonElement): void {
  setIcon(btn, 'error');
  btn.classList.add('copy-failed');
  scheduleReset(btn, () => {
    setIcon(btn, 'copy');
    btn.classList.remove('copy-failed');
  });
}

/** 文档级点击委托：点击 callout 复制按钮 → 复制整块源码 */
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-callout-copy]');
  if (!btn) return;
  const raw = btn.getAttribute('data-callout-source') ?? '';
  if (!raw) return;
  copyText(raw)
    .then(() => flash(btn))
    .catch(() => flashError(btn));
});
