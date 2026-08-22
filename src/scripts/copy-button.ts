/**
 * 代码块复制按钮（原生 JS，无依赖）
 *
 * - document 级事件委托：点击任意 [data-copy] 生效，View Transitions 后无需重绑；
 * - 复制时剔除行号 span（.line-number）与 aria-hidden 元素，保留纯代码文本；
 * - navigator.clipboard 不可用（非 https / 权限被拒）时回退 document.execCommand('copy')。
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

/** 复制文本：优先 Clipboard API，失败回退 execCommand */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* 权限被拒等场景走回退 */
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  // execCommand 已废弃但仍是唯一无需安全上下文/权限的兜底
  const execCopy = (document as unknown as {
    execCommand(commandId: string, showUI?: boolean, value?: string): boolean;
  }).execCommand;
  const ok = execCopy('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

/** 提取代码块纯文本（剔除行号与 aria-hidden 节点） */
function codeText(block: HTMLElement): string {
  const code = block.querySelector('code');
  if (!code) return '';
  const clone = code.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('.line-number, [aria-hidden]').forEach((el) => el.remove());
  return clone.textContent ?? '';
}

/** 文档级点击委托：点击复制按钮 → 复制所在代码块 */
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!btn) return;
  const block = btn.closest<HTMLElement>('[data-code-block]');
  if (!block) return;
  const text = codeText(block);
  if (!text) return;
  copyText(text)
    .then(() => flash(btn))
    .catch(() => {
      /* 复制失败静默（按钮保持原样） */
    });
});
