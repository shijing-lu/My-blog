/**
 * 代码块折叠 / 展开（原生 JS，document 级事件委托）
 *
 * - 控件：`[data-code-toggle]` 按钮；作用对象：`btn.closest('[data-code-block]')`
 * - 状态记在**目标元素**上：`data-collapsed="true"`（CSS 据此限高 + 内容向下淡出），
 *   组件只负责渲染控件与初始态，状态流转全在这里 —— 避免 React 状态与 DOM 两份真相。
 * - document 委托：View Transitions 换页、动态列表「加载更多」插入的新代码块
 *   都无需重新绑定（同 copy-button.ts 的做法）。
 * - 无障碍：按钮 `aria-expanded` 与 `title`、可见文案（收起/展开）同步切换。
 * - 折叠后若代码块顶部已滚出视口，把它带回视口顶部 —— 否则内容骤缩会让读者迷失位置。
 */

/** 折叠态属性（存在即折叠；显式 "true" 便于 CSS 选择器表达） */
const COLLAPSED_ATTR = 'data-collapsed';

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-code-toggle]');
  if (!btn) return;
  const block = btn.closest<HTMLElement>('[data-code-block]');
  if (!block) return;

  const nowCollapsed = block.getAttribute(COLLAPSED_ATTR) === 'true';
  const next = !nowCollapsed;

  if (next) block.setAttribute(COLLAPSED_ATTR, 'true');
  else block.removeAttribute(COLLAPSED_ATTR);

  // 控件自身状态：aria / title / 文案 / 图标（上箭头=可收起，下箭头=可展开）
  btn.setAttribute('aria-expanded', next ? 'false' : 'true');
  btn.setAttribute('title', next ? '展开代码' : '收起代码');
  btn.querySelector('[data-icon="collapse"]')?.classList.toggle('hidden', next);
  btn.querySelector('[data-icon="expand"]')?.classList.toggle('hidden', !next);
  const label = btn.querySelector('[data-toggle-text]');
  if (label) label.textContent = next ? '展开' : '收起';

  // 折叠后：块顶已滚出视口时带回视口顶部（内容骤缩会造成位置迷失）
  if (next && block.getBoundingClientRect().top < 0) {
    block.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});
