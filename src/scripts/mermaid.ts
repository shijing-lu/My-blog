/**
 * Mermaid 客户端渲染与交互控制脚本
 *
 * - 仅当页面存在 `[data-mermaid-block]` 或未处理的 `language-mermaid` 代码块时按需加载 `mermaid` 核心库；
 * - 自动感知明暗主题切换并重新生成对应主题配色 SVG；
 * - 提供「图表 / 查看源码」切换交互与一键代码复制；
 * - 语法错误友好拦截降级，避免崩溃整页，并自动露出代码源码方便排查。
 */

let mermaidLib: typeof import('mermaid')['default'] | null = null;

async function getMermaid() {
  if (!mermaidLib) {
    const mod = await import('mermaid');
    mermaidLib = mod.default;
  }
  return mermaidLib;
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-mode') === 'dark' ||
    document.documentElement.getAttribute('data-theme') === 'dark'
  );
}

/** 包装非 MDX 管道产出的原生 pre.language-mermaid 为标准结构 */
function upgradeRawMermaidBlocks(): void {
  const rawPres = document.querySelectorAll<HTMLPreElement>(
    'pre.code-block.language-mermaid:not([data-mermaid-source]):not([data-mermaid-processed]), pre.language-mermaid:not([data-mermaid-source]):not([data-mermaid-processed])'
  );

  rawPres.forEach((pre) => {
    pre.setAttribute('data-mermaid-processed', 'true');
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-block my-6 rounded-2xl border border-border/80 bg-card/60 overflow-hidden shadow-xs';
    wrapper.setAttribute('data-mermaid-block', '');
    wrapper.setAttribute('data-code-block', '');

    wrapper.innerHTML = `
      <div class="mermaid-header flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 text-xs text-muted-foreground select-none">
        <span class="flex items-center gap-2 font-mono font-medium text-foreground">
          <svg class="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="8" height="6" x="8" y="2" rx="1" />
            <path d="M12 8v4" />
            <rect width="8" height="6" x="2" y="14" rx="1" />
            <rect width="8" height="6" x="14" y="14" rx="1" />
            <path d="M6 14h12" />
          </svg>
          <span>图表 / Mermaid</span>
        </span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="mermaid-toggle-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono border border-border/80 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            data-mermaid-toggle
            title="切换图表与代码源码"
          >
            <span>查看代码</span>
          </button>
          <button
            type="button"
            class="copy-button p-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground cursor-pointer"
            data-copy
            aria-label="复制代码"
            title="复制代码"
          >
            <svg data-icon="copy" class="size-3.5" aria-hidden="true">
              <use href="#i-code-copy" />
            </svg>
            <svg data-icon="check" class="hidden size-3.5" aria-hidden="true">
              <use href="#i-code-check" />
            </svg>
          </button>
        </div>
      </div>
      <div class="mermaid-chart flex items-center justify-center p-6 overflow-x-auto min-h-[120px]" data-mermaid-chart>
        <div class="mermaid-loading flex items-center gap-2 text-xs text-muted-foreground py-4">
          <span class="size-2 rounded-full bg-primary animate-ping"></span>
          <span>正在渲染图表…</span>
        </div>
      </div>
    `;

    pre.parentNode?.insertBefore(wrapper, pre);
    pre.classList.add('mermaid-source', 'hidden', '!m-0', '!rounded-none', '!border-0', '!border-t', '!border-border/40');
    pre.setAttribute('data-mermaid-source', '');
    wrapper.appendChild(pre);
  });
}

/** 提取 Mermaid 原始文本代码 */
function getMermaidCode(block: HTMLElement): string {
  const sourceEl = block.querySelector<HTMLElement>('[data-mermaid-source]');
  const codeEl = sourceEl?.querySelector('code') || sourceEl;
  if (!codeEl) return '';
  const clone = codeEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden]').forEach((el) => el.remove());
  return (clone.textContent ?? '').trim();
}

let renderSeq = 0;
let isRendering = false;
let renderScheduled = false;

export async function renderAllMermaid(force = false): Promise<void> {
  if (isRendering) {
    renderScheduled = true;
    return;
  }
  isRendering = true;

  try {
    upgradeRawMermaidBlocks();

    const blocks = document.querySelectorAll<HTMLElement>('[data-mermaid-block]');
    if (blocks.length === 0) return;

    const dark = isDarkMode();
    const themeKey = dark ? 'dark' : 'light';

    const pendingBlocks = Array.from(blocks).filter((b) => {
      if (b.getAttribute('data-mermaid-rendering') === 'true') return false;
      if (force) return true;
      return b.getAttribute('data-mermaid-rendered') !== 'true' || b.getAttribute('data-mermaid-theme') !== themeKey;
    });

    if (pendingBlocks.length === 0) return;

    const mermaid = await getMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'inherit',
      themeVariables: dark
        ? {
            darkMode: true,
            background: 'transparent',
            primaryColor: '#3b82f6',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#60a5fa',
            lineColor: '#94a3b8',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
          }
        : {
            darkMode: false,
            background: 'transparent',
            primaryColor: '#2563eb',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#3b82f6',
            lineColor: '#64748b',
            secondaryColor: '#f1f5f9',
            tertiaryColor: '#e2e8f0',
          },
    });

    for (const block of pendingBlocks) {
      const chartEl = block.querySelector<HTMLElement>('[data-mermaid-chart]');
      const sourceEl = block.querySelector<HTMLElement>('[data-mermaid-source]');
      if (!chartEl) continue;

      const rawCode = getMermaidCode(block);
      if (!rawCode) {
        chartEl.innerHTML = '<p class="text-xs text-muted-foreground">图表内容为空</p>';
        block.setAttribute('data-mermaid-rendered', 'true');
        block.setAttribute('data-mermaid-theme', themeKey);
        continue;
      }

      block.setAttribute('data-mermaid-rendering', 'true');
      renderSeq += 1;
      const renderId = `mermaid-svg-${Date.now()}-${renderSeq}`;

      try {
        const renderPromise = mermaid.render(renderId, rawCode);
        const timeoutPromise = new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('图表渲染超时（超过 8 秒），请检查图表语法')), 8000);
        });
        const { svg, bindFunctions } = await Promise.race([renderPromise, timeoutPromise]);
        chartEl.innerHTML = svg;
        bindFunctions?.(chartEl);
        block.setAttribute('data-mermaid-rendered', 'true');
        block.setAttribute('data-mermaid-theme', themeKey);
      } catch (err) {
        console.error('[mermaid] Render failed for diagram:', err);
        // 清理 mermaid.render 失败时可能残留在 body 的临时元素
        document.getElementById(renderId)?.remove();
        document.getElementById('d' + renderId)?.remove();

        const errMsg = err instanceof Error ? err.message : String(err);
        chartEl.innerHTML = `
          <div class="mermaid-error p-3.5 w-full rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-xs">
            <div class="flex items-center gap-1.5 font-medium mb-1.5">
              <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Mermaid 图表解析错误</span>
            </div>
            <p class="opacity-80 font-mono text-[11px] leading-relaxed break-all">${errMsg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c)}</p>
          </div>
        `;

        // 语法错误时自动展开代码源码，方便作者对照修改
        sourceEl?.classList.remove('hidden');
        const toggleBtn = block.querySelector<HTMLButtonElement>('[data-mermaid-toggle]');
        if (toggleBtn) {
          toggleBtn.classList.add('bg-muted', 'text-foreground');
          const label = toggleBtn.querySelector('span');
          if (label) label.textContent = '隐藏代码';
        }

        block.setAttribute('data-mermaid-rendered', 'error');
        block.setAttribute('data-mermaid-theme', themeKey);
      } finally {
        block.removeAttribute('data-mermaid-rendering');
      }
    }
  } finally {
    isRendering = false;
    if (renderScheduled) {
      renderScheduled = false;
      void renderAllMermaid(force);
    }
  }
}

// 文档级委托：切换源码 / 图表
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const btn = target?.closest<HTMLButtonElement>('[data-mermaid-toggle]');
  if (!btn) return;
  const block = btn.closest<HTMLElement>('[data-mermaid-block]');
  if (!block) return;
  const sourceEl = block.querySelector<HTMLElement>('[data-mermaid-source]');
  if (!sourceEl) return;

  const isHidden = sourceEl.classList.contains('hidden');
  if (isHidden) {
    sourceEl.classList.remove('hidden');
    btn.classList.add('bg-muted', 'text-foreground');
    const label = btn.querySelector('span');
    if (label) label.textContent = '隐藏代码';
  } else {
    sourceEl.classList.add('hidden');
    btn.classList.remove('bg-muted', 'text-foreground');
    const label = btn.querySelector('span');
    if (label) label.textContent = '查看代码';
  }
});

// 监听 Astro 换页与自定义文章更新事件（涵盖 SSR 首次挂载、ClientRouter 转场、文档库切篇、首页单篇展开）
document.addEventListener('astro:page-load', () => {
  void renderAllMermaid();
});

document.addEventListener('astro:after-swap', () => {
  void renderAllMermaid();
});

document.addEventListener('article:body-updated', () => {
  void renderAllMermaid();
});

window.addEventListener('article:body-updated', () => {
  void renderAllMermaid();
});

// 监听主题切换（自定义事件 + class 变更）
window.addEventListener('byqx:theme-change', () => {
  void renderAllMermaid(true);
});

if (typeof MutationObserver !== 'undefined') {
  let lastDark = isDarkMode();
  const themeObserver = new MutationObserver(() => {
    const currentDark = isDarkMode();
    if (currentDark !== lastDark) {
      lastDark = currentDark;
      void renderAllMermaid(true);
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-mode', 'data-theme'],
  });
}

// 首次挂载运行
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void renderAllMermaid();
    });
  } else {
    void renderAllMermaid();
  }
}
