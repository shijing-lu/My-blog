/**
 * GSAP 按需加载与统一动画工具
 *
 * - gsap 核心 + ScrollTrigger 均动态 import，只在有动画的页面加载，不进首屏包；
 * - prefers-reduced-motion 时跳过动画（元素保持可见）；
 * - 统一入口：heroIn / initReveals / counterInView / dividerExpand，各页面 <script> 复用。
 */
import type { gsap as GsapType } from 'gsap';

let gsapPromise: Promise<typeof GsapType> | null = null;
let scrollTriggerLoaded = false;

/** 加载 gsap（needScrollTrigger 时注册 ScrollTrigger），返回 gsap 实例 */
export async function loadGsap(needScrollTrigger = false): Promise<typeof GsapType> {
  if (!gsapPromise) {
    gsapPromise = import('gsap').then((m) => m.gsap);
  }
  const gsap = await gsapPromise;
  if (needScrollTrigger && !scrollTriggerLoaded) {
    const mod = await import('gsap/ScrollTrigger');
    gsap.registerPlugin(mod.ScrollTrigger);
    scrollTriggerLoaded = true;
  }
  return gsap;
}

/** 用户是否偏好减少动画（尊重系统设置） */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** 统一入场 tween 参数（transform + opacity，合成器友好） */
export const REVEAL_EASE = 'power3.out' as const;

/**
 * Hero 进场序列：对 [data-hero] 元素依次上浮淡入
 * @param stagger 元素间隔秒
 */
export async function heroIn(stagger = 0.12): Promise<void> {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-hero]'));
  if (els.length === 0) return;
  const gsap = await loadGsap();
  if (prefersReducedMotion()) return;
  gsap.from(els, { y: 22, opacity: 0, duration: 0.85, stagger, ease: REVEAL_EASE });
}

/**
 * 滚动入场：扫描 [data-reveal] 元素（卡片/区块），进入视口依次浮现；
 * 并对 .pixel-divider 做 scaleX 展开。
 */
export async function initReveals(): Promise<void> {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  const dividers = Array.from(document.querySelectorAll<HTMLElement>('.pixel-divider'));
  if (reveals.length === 0 && dividers.length === 0) return;
  const gsap = await loadGsap(true);
  if (prefersReducedMotion()) return;

  reveals.forEach((el, i) => {
    gsap.fromTo(
      el,
      { y: 26, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        ease: REVEAL_EASE,
        // 同屏元素（如卡片网格）按文档序轻微错落
        delay: (i % 6) * 0.06,
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      },
    );
  });

  dividers.forEach((el) => {
    gsap.fromTo(
      el,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.9,
        ease: 'power2.inOut',
        scrollTrigger: { trigger: el, start: 'top 96%', once: true },
      },
    );
  });
}

/**
 * 统计数字滚动：进入视口后从 0 滚到 data-num（toLocaleString 格式化）
 */
export async function counterInView(selector: string): Promise<void> {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (els.length === 0) return;
  const gsap = await loadGsap();
  const fmt = (n: number): string => n.toLocaleString();
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        const target = Number(el.dataset.num ?? 0);
        if (prefersReducedMotion()) {
          el.textContent = fmt(target);
          return;
        }
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target,
          duration: 1.6,
          ease: 'power3.out',
          onUpdate: () => {
            el.textContent = fmt(Math.round(obj.v));
          },
        });
      });
    },
    { threshold: 0.3 },
  );
  els.forEach((el) => io.observe(el));
}