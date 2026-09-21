/**
 * HTML 转义（服务端与客户端共用的纯函数）
 *
 * 为什么单独成模块：所有 `src/lib/*-render.ts` 同构渲染模块都要转义用户内容
 * （站点标题、分类名、文档标题…），此前每个模块各写一份。转义规则一旦分叉，
 * 就会变成「某个页面 XSS、别的页面没有」这种最难排查的差异，所以集中一处。
 *
 * ⚠️ 本模块必须保持**零依赖**（不得 import db / drizzle / Node 内置模块），
 * 否则会被打进客户端包，见 MEMORY.md 的同构模块硬性约束。
 */

/** HTML 转义（文本节点与属性值通用；同时覆盖单双引号） */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
