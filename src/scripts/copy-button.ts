/**
 * 代码块复制按钮增强（原生 JS，无依赖）
 *
 * 侦测 `[data-code-block]` 内的 `[data-copy]` 按钮，点击复制代码文本；
 * 复制时剔除行号 span（.line-number）与 aria-hidden 元素，保留纯代码。
 * 模块级副作用：DOM 解析完成后绑定一次（防重复绑定）。
 */

/** 复制后：图标切到对勾并高亮 */
function flash(btn: HTMLButtonElement): void {
  const copyIcon = btn.querySelector('[data-icon="copy"]');
  const checkIcon = btn.querySelector('[data-icon="check"]');
  copyIcon?.classList.add('hidden');
  checkIcon?.classList.remove('hidden');
  btn.classList.add('text-primary');
  window.setTimeout(() => {
    copyIcon?.classList.remove('hidden');
    checkIcon?.classList.add('hidden');
    btn.classList.remove('text-primary');
  }, 1200);
}

/** 绑定所有代码块的复制行为 */
function bindCodeBlocks(): void {
  document.querySelectorAll<HTMLElement>('[data-code-block]').forEach((block) => {
    const btn = block.querySelector<HTMLButtonElement>('[data-copy]');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const code = block.querySelector('code');
      if (!code) return;
      const clone = code.cloneNode(true) as HTMLElement;
      clone.querySelectorAll<HTMLElement>('.line-number, [aria-hidden]').forEach((el) => el.remove());
      const text = clone.innerText ?? '';
      navigator.clipboard
        ?.writeText(text)
        .then(() => flash(btn))
        .catch(() => {
          /* 剪贴板不可用时静默 */
        });
    });
  });
}

if (typeof document !== 'undefined') {
  bindCodeBlocks();
}

export {};
