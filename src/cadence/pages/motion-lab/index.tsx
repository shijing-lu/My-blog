/**
 * 动效实验室（路由薄壳）
 *
 * 实现放在 shared/motion/lab —— 业务层被禁止直接引用动画原语（红线 R7），
 * 而实验室的职责恰恰是展示动画原语本身，因此它归属于动画系统。
 * 这一层只负责把它挂到路由上，并保持懒加载（独立 chunk，不进首屏）。
 */

import { MotionLab } from "@/cadence/shared/motion/lab";

export function MotionLabPage() {
  return <MotionLab />;
}
