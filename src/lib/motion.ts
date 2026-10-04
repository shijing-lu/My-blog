/** 轻量动效运行时：状态由调用方同步更新；动画仅作可取消的视觉反馈。 */
export type MotionKind = 'enter' | 'change' | 'success' | 'exit';

const active = new Set<Animation>();
const owned = new WeakMap<Element, Animation>();
let initialized = false;
let mountedBody: HTMLElement | undefined;
let reveals: IntersectionObserver | undefined;
let seen = new WeakSet<Element>();
const revealSelector = '.post-card, .post-row, .moment-card, .photo-card, .activity-heatmap, [data-note-id], [data-reveal]';

/** CSS 压缩器会把 240ms 写成 .24s，WAAPI 始终要求毫秒。 */
export function motionMilliseconds(value: string, fallback = 160): number {
  const time = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)(?:ms|s)$/.test(time)) return fallback;
  const duration = Number.parseFloat(time) * (time.endsWith('ms') ? 1 : 1000);
  return Number.isFinite(duration) ? Math.min(duration, 1000) : fallback;
}

export function reducedMotion(): boolean {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cancelMotion(element?: Element): void {
  if (element) owned.get(element)?.cancel();
  else for (const animation of active) animation.cancel();
}

/** 同一元素只拥有一个反馈动画；不会取消其它组件或库持有的动画。 */
export function feedback(element: Element | null, kind: MotionKind = 'change', delay = 0): Promise<void> {
  if (!element) return Promise.resolve();
  cancelMotion(element);
  if (!element.isConnected || reducedMotion() || document.hidden || typeof element.animate !== 'function') {
    return Promise.resolve();
  }
  const frames: Record<MotionKind, Keyframe[]> = {
    enter: [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
    change: [{ opacity: 0.65 }, { opacity: 1 }],
    success: [{ scale: '1' }, { scale: '1.12', offset: 0.4 }, { scale: '1' }],
    exit: [{ opacity: 1 }, { opacity: 0 }],
  };
  const styles = getComputedStyle(document.documentElement);
  const duration = motionMilliseconds(styles.getPropertyValue(
    kind === 'enter' || kind === 'success' ? '--motion-duration-base' : '--motion-duration-fast',
  ));
  try {
    const animation = element.animate(frames[kind], {
      duration, delay: Math.min(Math.max(delay, 0), 120),
      easing: styles.getPropertyValue('--motion-ease-standard').trim() || 'ease-out',
      // 不预先隐藏等待 stagger 的元素，不保留 inline style / 动画合成层。
      fill: 'none',
    });
    owned.set(element, animation);
    active.add(animation);
    return animation.finished.then(() => {}, () => {}).finally(() => {
      active.delete(animation);
      if (owned.get(element) === animation) owned.delete(element);
    });
  } catch {
    return Promise.resolve();
  }
}

/** 新插入列表显式接入；无需观察整个 body 的每一次编辑器/流式消息更新。 */
export function revealWithin(root: ParentNode = document): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(revealSelector));
  if (root instanceof HTMLElement && root.matches(revealSelector)) elements.unshift(root);
  for (const element of elements) {
    if (seen.has(element)) continue;
    seen.add(element);
    element.classList.remove('reveal');
    element.classList.add('revealed');
    if (!reducedMotion()) reveals?.observe(element);
  }
}

export function initMotion(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  const reset = (): void => {
    mountedBody = undefined;
    cancelMotion();
    reveals?.disconnect();
    reveals = undefined;
    seen = new WeakSet();
  };
  const mount = (): void => {
    if (mountedBody === document.body) return;
    reset();
    mountedBody = document.body;
    if (!reducedMotion() && 'IntersectionObserver' in window) {
      reveals = new IntersectionObserver((entries) => {
        let order = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveals?.unobserve(entry.target);
          if (order < 6) void feedback(entry.target, 'enter', order++ * 20);
        }
      }, { threshold: 0.04 });
    }
    revealWithin();
  };
  document.addEventListener('astro:before-preparation', reset);
  document.addEventListener('astro:page-load', mount);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelMotion(); });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { reset(); mount(); });
  document.addEventListener('invalid', (event) => {
    if (event.target instanceof HTMLElement) void feedback(event.target);
  }, true);
  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLImageElement && event.target.closest('.photo-wrap')) void feedback(event.target);
  }, true);
  document.addEventListener('toggle', (event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.open) return;
    const content = Array.from(event.target.children).find((child) => child.tagName !== 'SUMMARY');
    if (content) void feedback(content, 'change');
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}
