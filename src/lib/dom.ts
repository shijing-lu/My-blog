/**
 * 防 View Transitions 绑定失效的事件委托工具
 *
 * 背景：本项目的 SPA 切换（ClientRouter）会替换 DOM，但页面内联脚本（ES module）
 * 只执行一次——直接 `document.getElementById(...).addEventListener(...)` 的绑定
 * 在切走再切回后会失效（点击无反应、不发请求）。document 级委托不受影响。
 *
 * 用法（与 addEventListener 同构，替换前缀即可）：
 *   on('bg-save', 'click', () => { ... });
 *   on('bg-file', 'change', async (e) => { ... });
 */
export function on(id: string, event: string, handler: EventListener): void {
  document.addEventListener(event, (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.id === id || t.closest(`#${id}`))) handler(e);
  });
}

/** 按选择器委托（用于 [data-*] 类按钮组） */
export function onAny(selector: string, event: string, handler: EventListener): void {
  document.addEventListener(event, (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest(selector)) handler(e);
  });
}
