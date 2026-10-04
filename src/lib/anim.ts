/** 兼容旧调用入口，普通首页动效统一交给原生 WAAPI，不再下载 GSAP/ScrollTrigger。 */
import { feedback, revealWithin, reducedMotion } from './motion';
export const prefersReducedMotion = reducedMotion;

export async function heroIn(stagger = 0.02): Promise<void> {
  const fresh = Array.from(document.querySelectorAll<HTMLElement>('[data-hero]:not([data-hero-done])'));
  await Promise.all(fresh.map((element, index) => {
    element.dataset.heroDone = '';
    return index < 6 ? feedback(element, 'enter', index * stagger * 1000) : Promise.resolve();
  }));
}

export async function initReveals(): Promise<void> { revealWithin(); }

/** 数值始终是真实终值；取消逐帧改 textContent 引起的布局/读屏噪声。 */
export async function counterInView(selector: string): Promise<void> {
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const value = Number(element.dataset.num);
    if (Number.isFinite(value)) element.textContent = value.toLocaleString();
  });
}
