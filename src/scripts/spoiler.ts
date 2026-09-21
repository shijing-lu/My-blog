/**
 * 黑幕（spoiler）行内隐藏模式开关 —— 原生 JS，无依赖
 *
 * - 语法：`:spoiler[内容]`（remarkSpoiler → <Spoiler> 原生 button）；
 * - **默认关闭**：正文完整显示；开启后（<html data-spoiler-hide="on">）黑幕遮罩生效，
 *   悬停 / 键盘聚焦 / 点击（aria-expanded）揭示，再点收回；
 * - 开关按钮由本脚本**按需注入**：仅当当前文章渲染出了 `.spoiler[data-spoiler]`
 *   （即源码确实含有该语法）时，才在正文容器顶部插入「黑幕」按钮——
 *   服务端无需额外判断，无 JS 环境按钮自然不出现（黑幕保持完整显示，无障碍）；
 * - 模式持久化 localStorage；View Transitions 转场、文档编辑器刷新正文后
 *   由 astro:page-load / spoiler:refresh 事件重放（注入与状态同步均幂等）；
 * - 与 copy-button / tabs / lightbox 同一模式：**document 级事件委托**，无需重绑。
 */

/** localStorage 键（'on' | 'off'） */
const STORAGE_KEY = 'byqx-spoiler-hide';

function isOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false; // 隐私模式等场景：退化为仅当前文档生效
  }
}

function setMode(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* 写入失败仅影响跨页持久化，当前文档仍由 data 属性驱动 */
  }
}

/** 把当前模式同步到 <html data-spoiler-hide> 与所有开关按钮（幂等） */
function applyMode(): void {
  const on = isOn();
  document.documentElement.dataset.spoilerHide = on ? 'on' : 'off';
  document.querySelectorAll<HTMLButtonElement>('[data-spoiler-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-active', on);
  });
}

/** 文章含黑幕时在正文容器顶部注入「黑幕」开关；不含时移除残留开关（幂等、双向）。
 *
 * 文档页在**页内切换文章**时用 innerHTML 重写正文（doc/[id].astro），按钮会随旧内容
 * 一起被清掉；配合 spoiler:refresh 事件重放本函数即可重建。反向场景：从含黑幕的
 * 文章切到不含黑幕的文章，旧按钮必须移除，否则开关指向空内容。
 */
function ensureToggle(): void {
  const art = document.querySelector('article.prose') ?? document.querySelector('article');
  if (!art) return;
  const existing = art.querySelector(':scope > .spoiler-toggle-wrap');
  if (!art.querySelector('.spoiler[data-spoiler]')) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const wrap = document.createElement('div');
  wrap.className = 'spoiler-toggle-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'spoiler-toggle';
  btn.dataset.spoilerToggle = '';
  btn.setAttribute('aria-pressed', String(isOn()));
  btn.title = '切换黑幕：开启后隐藏 :spoiler[...] 标记的内容';
  btn.textContent = '黑幕';
  wrap.appendChild(btn);
  art.prepend(wrap);
}

let bound = false;
function bindOnce(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target) return;
    // ① 模式开关：点击切换 + 持久化 + 全站状态同步
    const toggle = target.closest<HTMLButtonElement>('[data-spoiler-toggle]');
    if (toggle) {
      setMode(!isOn());
      applyMode();
      return;
    }
    // ② 黑幕本体：仅在隐藏模式开启时，点击切换展开 / 收回
    if (document.documentElement.dataset.spoilerHide !== 'on') return;
    const sp = target.closest<HTMLElement>('.spoiler[data-spoiler]');
    if (!sp) return;
    const open = sp.getAttribute('aria-expanded') === 'true';
    sp.setAttribute('aria-expanded', String(!open));
    sp.classList.toggle('is-open', !open);
  });
}

/** 转场 / 正文刷新后的重建入口（全部幂等，可重复触发） */
function init(): void {
  bindOnce();
  applyMode();
  ensureToggle();
}

init();
// View Transitions 转场完成后新 DOM 重新同步 + 按需注入
document.addEventListener('astro:page-load', init);
// 文档页就地编辑器（DocInlineEditor）刷新正文后重建按钮
document.addEventListener('spoiler:refresh', init);
