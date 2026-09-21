/**
 * 黑幕（spoiler）组件：`:spoiler[内容]` 行内指令的渲染产物
 *
 * ## 设计
 *
 * - 渲染为**原生 `<button>`**：无 JS 时悬停 / 键盘聚焦仍可揭示（CSS），
 *   有 JS 时点击 / Enter / Space 切换展开（原生按钮自带键盘激活，脚本只处理
 *   click 委托即可，见 src/scripts/spoiler.ts）；
 * - `aria-expanded` 表达展开状态；`data-spoiler` 供页面侧探测
 *   「本文是否含有黑幕」（`html.includes('data-spoiler')`，服务端判断是否渲染开关）；
 * - 默认（隐藏模式关闭）正文**完整显示**；仅当 `<html data-spoiler-hide="on">`
 *   时才进入遮罩态（样式见 global.css 的 spoiler 段）。
 */
import type { ReactNode } from 'react';

export default function Spoiler({ children }: { children?: ReactNode }) {
  return (
    <button type="button" className="spoiler" data-spoiler="" aria-expanded="false">
      <span className="spoiler-body">{children}</span>
    </button>
  );
}
