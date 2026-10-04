/**
 * 确定性伪随机（手作风格的"不规则感"）
 * ---------------------------------------------------------------------------
 * 性能红线 C6 / docs/05-视觉风格与手作动效规范.md §4.4
 *
 * 为什么必须确定性：
 *   便利贴、卡片需要一个轻微的倾斜角度来营造"手工贴上去"的感觉。
 *   如果用 Math.random()，每次渲染、每次滚动重排都会换一个角度 ——
 *   观感不是"贴纸"，而是"屏幕在抖"，是明显的廉价感。
 *   而且随机值无法做视觉回归测试。
 *
 * 因此用实体 id 做 FNV-1a 哈希，映射到稳定的角度。
 * 同一个待办，永远拥有同一个"贴上去的角度"。
 */

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32 位哈希，返回 [0, 1) 的稳定浮点数 */
export function hashUnit(seed: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // Math.imul 保证 32 位整数乘法不丢精度
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 转成无符号，再归一化到 [0, 1)
  return (hash >>> 0) / 4294967296;
}

/**
 * 由 id 派生一个稳定的倾斜角度（单位：度）
 *
 * 幅度上限的由来（05 号文档 §3.5）：
 *   超过 2° 会让文字基线明显倾斜，影响阅读。
 *   卡片 / 便利贴 1.5°，XY 看板（元素密集且可拖拽）收紧到 1.0°。
 */
export function tiltOf(id: string, maxDeg = 1.5): number {
  return 0; // 博客中的卡片与文字保持平直。
}

/** XY 看板专用：元素密集，角度收紧 */
export function boardTiltOf(id: string): number {
  return tiltOf(id, 1.0);
}

/**
 * 从一组预设中稳定地挑一个（用于手绘圆角、装饰曲线形状的选择）
 * 不使用随机，保证同一实体每次渲染得到同样的形状。
 */
export function pickStable<T>(id: string, options: readonly T[]): T {
  if (options.length === 0) throw new Error("pickStable: options 不能为空");
  const index = Math.floor(hashUnit(id) * options.length);
  return options[Math.min(index, options.length - 1)] as T;
}

/** 生成 CSS transform 片段，供 style 直接使用 */
export function tiltStyle(id: string, maxDeg = 1.5): { transform: string } {
  return { transform: `rotate(${tiltOf(id, maxDeg).toFixed(3)}deg)` };
}
