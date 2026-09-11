/**
 * 代码块复制按钮（原生 JS，无依赖）
 *
 * - document 级事件委托：点击任意 [data-copy] 生效，View Transitions 后无需重绑；
 * - 复制时剔除 aria-hidden 元素（行号数字由 CSS ::before 伪元素渲染，不在文本流，
 *   无需额外剔除——⚠️ 勿把 .line-number/.code-line 行容器当"行号元素"移除：
 *   rehype-prism-plus 把每行代码都包在 `<span class="code-line line-number">` 里，
 *   移除它会删光全部代码文本（曾导致复制功能静默失效）；
 * - navigator.clipboard 不可用（非 https / 权限被拒）时回退 document.execCommand('copy')；
 * - 成功 → 对勾 + .copied 高亮；失败 → .copy-failed 抖动提示（不再静默）。
 */

/** 反馈时长（ms） */
const FLASH_MS = 1400;

/**
 * 待复位定时器：按按钮归集
 *
 * 原实现每次点击都无条件 `setTimeout`，连点同一个按钮时多个定时器并存，
 * 先触发的那个会把后一次点击的高亮提前抹掉（"点了没反应"的观感）。
 * 这里改为「同按钮只保留一个」：新的复位安排前先取消旧的。
 */
const resetTimers = new WeakMap<HTMLButtonElement, number>();

/** 安排一次状态复位（同按钮的旧定时器先取消） */
function scheduleReset(btn: HTMLButtonElement, fn: () => void): void {
  const prev = resetTimers.get(btn);
  if (prev !== undefined) window.clearTimeout(prev);
  resetTimers.set(
    btn,
    window.setTimeout(() => {
      resetTimers.delete(btn);
      fn();
    }, FLASH_MS),
  );
}

/** 复制成功：图标切到对勾并高亮 */
function flash(btn: HTMLButtonElement): void {
  const copyIcon = btn.querySelector('[data-icon="copy"]');
  const checkIcon = btn.querySelector('[data-icon="check"]');
  copyIcon?.classList.add('hidden');
  checkIcon?.classList.remove('hidden');
  btn.classList.add('copied');
  scheduleReset(btn, () => {
    copyIcon?.classList.remove('hidden');
    checkIcon?.classList.add('hidden');
    btn.classList.remove('copied');
  });
}

/** 复制失败：抖动 + 红色提示（不再静默吞掉） */
function flashError(btn: HTMLButtonElement): void {
  btn.classList.remove('copied');
  btn.classList.add('copy-failed');
  btn.setAttribute('title', '复制失败，请手动选择代码复制');
  scheduleReset(btn, () => {
    btn.classList.remove('copy-failed');
    btn.setAttribute('title', '复制代码');
  });
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

/** 提取代码块纯文本（剔除 aria-hidden 节点；行容器保留，见文件头注释） */
function codeText(block: HTMLElement): string {
  const code = block.querySelector('code');
  if (!code) return '';
  const clone = code.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('[aria-hidden]').forEach((el) => el.remove());
  // CRLF → LF：源文件行尾不带入剪贴板（避免粘贴到部分编辑器出现 ^M）
  return (clone.textContent ?? '').replace(/\r\n/g, '\n');
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
    .catch(() => flashError(btn));
});
