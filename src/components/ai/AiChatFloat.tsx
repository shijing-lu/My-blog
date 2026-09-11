/**
 * AiChatFloat.tsx —— AI 助手「小卿」悬浮交互（React 岛，BaseLayout 全站挂载 client:idle）
 *
 * 职责（对应开发计划 F2/F3/F4/F5）：
 * - F2 选中文本右键：捕获阶段监听 document contextmenu，全站任意位置有选区时自绘「问问小卿」
 *   菜单并屏蔽原生菜单（可编辑控件内放行）；选区含 KaTeX 公式时从 MathML annotation 取回
 *   原始 TeX 源码（$…$ / $$…$$），避免 toString() 视觉文本丢格式；
 * - F3 悬浮框：鼠标附近 clamp 定位弹出，自动把选中文字模板化为首条消息发送，SSE 流式渲染；
 * - F4 多轮追问：messages 累积，回答中可继续输入，新发送时 abort 旧流（保留已生成文本）；
 * - F5 可调整大小：右/下/右下三向自绘手柄拖拽 resize（**尺寸不持久化**，每次打开均以默认尺寸初始化）；
 * - 附加：标题栏拖动移动浮窗、Esc 关闭、自动滚动（stick-to-bottom：ResizeObserver 跟滚流式增高
 *   + 发送后平滑到底 + 上滚暂停跟随）；回答渲染走 marked + KaTeX（$…$ / $$…$$）+ DOMPurify。
 *
 * 会话语义（重要）：**每次选词提问都是一个全新对话**——打开浮窗或关闭浮窗（含 Esc、清空按钮）
 * 都会终止在途流并清空消息与上下文，确保不会把上一轮历史带给模型。**尺寸亦不持久化**：
 * 每次打开浮窗一律以 DEFAULT_W/DEFAULT_H 初始化（早期版本把尺寸写入 localStorage 跨会话沿用，
 * 现已移除该行为并清理遗留键）；消息同样不持久化（早期版本写 sessionStorage，现已清除）。
 *
 * SSE 帧格式（服务端 /api/ai/chat 重帧）：data: {"delta":"…"} / {"error":"…"} / {"done":true}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Square, Trash2, X } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { KATEX_ALLOWED_TAGS, KATEX_RENDER_OPTIONS } from '@/lib/math-sanitize';

interface Props {
  /** SSR 判定 AI 是否就绪（enabled + baseUrl/apiKey/model 齐全）；false 时组件不渲染任何 UI */
  enabled: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 右键菜单状态 */
interface MenuState {
  x: number;
  y: number;
  /** 选中文字（≤2000 字符） */
  text: string;
  /** 来源页标题（去站点后缀） */
  title: string;
}

/** 选区落在可编辑控件内时放行原生右键菜单（保留粘贴/拼写纠错能力） */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';
const MAX_SELECTION_CHARS = 2000;
const MIN_W = 320;
const MIN_H = 360;
const DEFAULT_W = 380;
const DEFAULT_H = 480;
const MARGIN = 12;

/** 遗留键：早期版本曾把浮窗尺寸写入 localStorage 跨会话沿用，现已取消持久化，仅用于清理 */
const SIZE_KEY = 'ai_float_size_v1';
const MESSAGES_KEY = 'ai_chat_messages_v1';

interface FloatPos {
  x: number;
  y: number;
}

/** 视口 clamp：保证 [w,h] 的盒子完整落在视口内 */
function clampRect(x: number, y: number, w: number, h: number): FloatPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - h - MARGIN)),
  };
}

/**
 * 初始尺寸：恒定返回默认值（**不做任何持久化读取**）。
 * 语义要求——聊天框不记住旧尺寸，每次进入都以默认尺寸重新初始化；
 * 此处只做一次视口保护：窗口比默认值还小时（如移动端极窄屏）向下压缩，避免溢出视口。
 */
function initialSize(): { w: number; h: number } {
  return {
    w: Math.min(DEFAULT_W, Math.max(MIN_W, window.innerWidth - MARGIN * 2)),
    h: Math.min(DEFAULT_H, Math.max(MIN_H, window.innerHeight - MARGIN * 2)),
  };
}

/** 页面标题去站点后缀（「xxx · 站名」→「xxx」） */
function pageTitle(): string {
  const t = document.title || '';
  const idx = t.lastIndexOf(' · ');
  return (idx > 0 ? t.slice(0, idx) : t).trim();
}

/**
 * 选区内容提取：选区内含 KaTeX 公式时，从其 MathML annotation（encoding="application/x-tex"）
 * 取回**原始 TeX 源码**替换视觉文本——getSelection().toString() 只能拿到渲染后的二维排版
 * 线性化文本（分式/上下标/根号结构丢失变形），而 annotation 保存着无损源码（与 mdx-plugins.ts
 * 的 TOC 提取同源逻辑）。行内公式 → $…$，块级公式（.katex-display）→ $$…$$。
 */
function extractSelectionText(): string {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (!range) return '';
  const frag = range.cloneContents();
  for (const k of Array.from(frag.querySelectorAll('.katex'))) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? '';
    if (tex === '') continue; // 部分选中的公式克隆不出 annotation → 保留视觉文本优雅降级
    const display = k.closest('.katex-display');
    const replacement = document.createTextNode(display ? `$$${tex}$$` : `$${tex}$`);
    (display ?? k).replaceWith(replacement);
  }
  return (frag.textContent ?? '').trim();
}

/** 首条消息模板：把选中文字模板化为解释请求 */
function buildFirstMessage(text: string, title: string): string {
  return `请解释/分析以下我选中的内容（来自「${title}」）：\n"""\n${text}\n"""`;
}

marked.setOptions({ gfm: true, breaks: true });

/** 行内公式 $...$（不跨行、内部无空白边界）与块级公式 $$...$$（可跨行） */
/*
 * P2-23（已评估，决定保留 marked —— 不是遗漏，是有意取舍）：
 * 审查曾建议「AI 回答改用 /api/doc/preview 复用主渲染管线」以消除双管线漂移。
 * 实测该方案**不可行**，原因：
 *   1. /api/doc/preview 走的是服务端 renderMdx（6 层预处理 + @mdx-js/mdx 编译 +
 *      rehype-katex），单次耗时在百毫秒量级；而 AI 回答是**流式**的，
 *      每个 token 分片都要重渲染一次 → 会退化成每分片一次 HTTP 往返，延迟爆掉；
 *   2. 主管线输出的是完整 MDX 组件树，含有 React 岛 / 折叠卡等结构，
 *      放进聊天气泡里既不安全也不合适。
 * 因此这里保留轻量客户端 markdown（marked + KaTeX + DOMPurify）。
 * 为控制「语义漂移」风险，把两边**真正需要保持一致**的部分抽成共享常量：
 *   - 数学语法：统一使用 `@/lib/math-sanitize` 的 KaTeX 渲染选项与消毒白名单；
 *   - 其余（callout 语法等）AI 场景本就不需要，不做对齐。
 */
const MATH_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;
const MATH_INLINE_RE = /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g;

/** 把 TeX 渲染为 KaTeX HTML（失败时回退为等宽原文，避免整条回答渲染崩掉） */
function renderTex(tex: string, displayMode: boolean): string {
  try {
    // 与主渲染管线共用同一份 KaTeX 选项（output: htmlAndMathml → 字体失败时 MathML 兜底）
    return katex.renderToString(tex, { ...KATEX_RENDER_OPTIONS, displayMode });
  } catch {
    return `<code>${displayMode ? `$$${tex}$$` : `$${tex}$`}</code>`;
  }
}

/**
 * Markdown → 消毒后 HTML（仅用于 assistant 回答；user 消息永远纯文本渲染）。
 * 数学公式管线：先把 $$…$$ / $…$ 抽出为占位符 → marked 解析（避免 \frac、矩阵 `&`、`\\`、
 * `a_1`/`x^2` 被当成 Markdown 语法误伤，例如 `_` 触发斜体、`&` 变实体）→ 再把占位符
 * 替换为 KaTeX 渲染结果 → 最后统一消毒（KaTeX 输出含 MathML + 内联样式，需放行）。
 * 样式复用 BaseLayout 全局引入的 katex.min.css，岛内无需重复引入。
 */
function renderMarkdown(md: string): string {
  const slots: { key: string; html: string }[] = [];
  const stash = (tex: string, displayMode: boolean): string => {
    const key = `@@AI_MATH_${slots.length}@@`;
    slots.push({ key, html: renderTex(tex, displayMode) });
    return key;
  };
  const prepared = md
    .replace(MATH_BLOCK_RE, (_m, tex: string) => stash(tex, true))
    .replace(MATH_INLINE_RE, (_m, tex: string) => stash(tex, false));
  const raw = marked.parse(prepared, { async: false });
  let html = typeof raw === 'string' ? raw : '';
  for (const { key, html: texHtml } of slots) html = html.split(key).join(texHtml);
  // 白名单与主管线共用（见 @/lib/math-sanitize 注释）：MathML/内联 SVG 不放行会被静默删掉
  return DOMPurify.sanitize(html, { ADD_TAGS: [...KATEX_ALLOWED_TAGS] });
}

/** 主人身份（顶级管理员）模块级缓存：页面生命周期内只请求一次 /api/admin-auth/me */
let ownerBadgeCache: boolean | null = null;

export default function AiChatFloat({ enabled }: Props) {
  /* ---------- 状态 ---------- */
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FloatPos>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ w: number; h: number }>({ w: DEFAULT_W, h: DEFAULT_H });
  const [selectionCtx, setSelectionCtx] = useState<{ text: string; title: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 内层内容 wrapper（ResizeObserver 监听其高度变化：流式增高/图片加载/渲染换行都能跟上） */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** 贴底跟踪：用户手动上滚（离底 >80px）暂停自动滚动，回到底部附近恢复 */
  const stickRef = useRef(true);
  /** 关闭浮窗回调（Esc 全局监听器在 useCallback 之前注册，需经 ref 引用避免闭包顺序问题） */
  const closeRef = useRef<(() => void) | null>(null);
  /** 最新消息快照（send 组装历史用，避免在 setState updater 里做副作用） */
  const messagesRef = useRef<ChatMessage[]>([]);
  /** 输入框节点：浮窗打开后把焦点送进去（P2-18 对话框焦点管理） */
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 打开浮窗前的焦点位置，关闭时还原，避免焦点掉到 <body> 造成键盘用户迷失 */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /**
   * P2-18：对话框焦点管理
   * 打开 → 焦点进入浮窗输入框；关闭 → 还原到打开前的元素。
   * 说明：本浮窗是**非模态**对话框（无遮罩、不锁滚动，用户仍可继续选中正文提问），
   * 因此用 aria-modal={false} 且不劫持 Tab——强行做焦点陷阱反而会阻断"边读边问"的主流程。
   */
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  }, [open]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** 当前浏览者是主人（顶级管理员）→ 浮窗显示徽标；仅 UI 展示，服务端独立判定不受此处影响 */
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (ownerBadgeCache !== null) {
      if (ownerBadgeCache) setIsOwner(true);
      return;
    }
    let alive = true;
    fetch('/api/admin-auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { identity?: string; account?: { role?: string } } | null) => {
        if (!d) return;
        const owner = d.identity === 'top' || (d.identity === 'github' && d.account?.role === 'top');
        ownerBadgeCache = owner;
        if (alive && owner) setIsOwner(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);

  /* ---------- 尺寸初始化（ClientRouter 转场岛重建后执行） ---------- */
  /* 说明：消息与尺寸均**不跨页面/跨会话持久化**——每次重建都回到默认尺寸（见 initialSize），
     消息在每次「重新选词提问」或关闭浮窗时清空（见 openFloat/resetConversation）。 */
  useEffect(() => {
    if (!enabled) return;
    setSize(initialSize());
    return () => abortRef.current?.abort();
  }, [enabled]);

  /* ---------- 遗留数据清理：历史版本曾把消息写 sessionStorage、尺寸写 localStorage，启动时清除 ---------- */
  useEffect(() => {
    if (!enabled) return;
    try {
      sessionStorage.removeItem(MESSAGES_KEY);
    } catch {
      /* 隐私模式忽略 */
    }
    try {
      localStorage.removeItem(SIZE_KEY);
    } catch {
      /* 隐私模式忽略 */
    }
  }, [enabled]);

  /* ---------- 流式消费 SSE ---------- */
  const consumeStream = useCallback(async (res: Response, controller: AbortController) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('响应无内容');
    const decoder = new TextDecoder();
    let buffer = '';
    const appendDelta = (delta: string): void => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1]!;
        if (last.role !== 'assistant') return prev;
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: last.content + delta };
        return next;
      });
    };
    while (true) {
      if (controller.signal.aborted) {
        reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim()) as { delta?: string; error?: string; done?: boolean };
          if (typeof payload.delta === 'string' && payload.delta !== '' && !controller.signal.aborted) appendDelta(payload.delta);
          if (payload.error) throw new Error(payload.error);
          // done 帧无需处理：随后 read() 自然 done
        } catch (e) {
          if (e instanceof SyntaxError) continue; // 半帧跳过
          throw e;
        }
      }
    }
  }, []);

  /* ---------- 发送（F3 自动发送 / F4 追问共用）：新发送 abort 旧流，保留已生成文本 ---------- */
  const send = useCallback(
    async (content: string) => {
      const outgoing = content.trim();
      if (outgoing === '') return;
      if (streaming) abortRef.current?.abort(); // 回答中发送 → 终止旧流，立即开始新回答

      const controller = new AbortController();
      abortRef.current = controller;

      // 组装请求历史（过滤半截占位，不含占位 assistant）
      const history = messagesRef.current.filter(
        (m) => m.role === 'user' || (m.role === 'assistant' && m.content !== ''),
      );
      const next: ChatMessage[] = [
        ...history,
        { role: 'user', content: outgoing },
        { role: 'assistant', content: '' },
      ];
      messagesRef.current = next;
      setMessages(next);

      setStreaming(true);
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: next.slice(0, -1) }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `请求失败（HTTP ${res.status}）`);
        }
        await consumeStream(res, controller);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = err instanceof Error ? err.message : '请求失败';
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1]!;
            if (last.role !== 'assistant' || last.content !== '') return prev;
            const next2 = [...prev];
            next2[next2.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
            messagesRef.current = next2;
            return next2;
          });
        }
      } finally {
        if (abortRef.current === controller) {
          setStreaming(false);
          abortRef.current = null;
        }
      }
    },
    [streaming, consumeStream],
  );

  /* ---------- F2：捕获阶段 contextmenu，全站任意位置选区 → 自绘菜单（屏蔽原生菜单） ---------- */
  useEffect(() => {
    if (!enabled) return;
    // 水合完成标记（E2E 依赖：client:idle 水合晚于页面 load）
    document.documentElement.dataset.aiFloatReady = '1';
    const onContextMenu = (e: MouseEvent): void => {
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      const el = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null);
      if (el?.closest(EDITABLE_SELECTOR)) return; // 可编辑控件内放行原生菜单（粘贴/纠错）
      const text = extractSelectionText();
      if (text === '') return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, text: text.slice(0, MAX_SELECTION_CHARS), title: pageTitle() });
    };
    const onPointerDown = (e: PointerEvent): void => {
      // 点击别处关闭菜单（浮窗/菜单自身除外）
      const target = e.target as Element | null;
      if (menu && !target?.closest('#ai-context-menu')) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenu(null);
        // 关闭浮窗同样结束本次对话（清空历史），经 ref 调用规避闭包顺序
        closeRef.current?.();
      }
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, menu]);

  /* 会话重置：终止在途流、清空消息与选区上下文、清掉遗留持久化数据，保证下一次提问是干净上下文 */
  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    messagesRef.current = [];
    setMessages([]);
    setSelectionCtx(null);
    setInput('');
    setStreaming(false);
    try {
      sessionStorage.removeItem(MESSAGES_KEY);
    } catch {
      /* 忽略 */
    }
  }, []);

  /* ---------- 菜单点击 → 弹出浮窗 + 自动发送选中文字 ---------- */
  /* ⚠️ 每次选词提问都是**新对话**：先清空上一轮的消息与上下文（含在途流），再发送首条消息，
     避免把旧历史一并带给模型，也避免旧问答残留在浮窗里。 */
  const openFloat = useCallback(
    (m: MenuState) => {
      setMenu(null);
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetConversation();
      setSelectionCtx({ text: m.text, title: m.title });
      // 每次打开都回到默认尺寸（不读取任何持久化记忆/缓存）
      const { w, h } = initialSize();
      setSize({ w, h });
      // 鼠标附近弹出：右侧优先，放不下翻转左侧，统一 clamp
      const flipX = m.x + MARGIN + w > window.innerWidth;
      const p = clampRect(flipX ? m.x - w - MARGIN : m.x + MARGIN, m.y + MARGIN, w, h);
      setPos(p);
      setOpen(true);
      void send(buildFirstMessage(m.text, m.title));
    },
    [send, resetConversation],
  );

  /* ---------- F5：三向 resize（右/下/右下） ---------- */
  const startResize = useCallback(
    (dir: 'e' | 's' | 'se') => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const { w: w0, h: h0 } = size;
      const onMove = (ev: PointerEvent): void => {
        const dw = dir === 's' ? 0 : ev.clientX - startX;
        const dh = dir === 'e' ? 0 : ev.clientY - startY;
        const w = Math.min(Math.max(MIN_W, w0 + dw), window.innerWidth - MARGIN * 2);
        const h = Math.min(Math.max(MIN_H, h0 + dh), window.innerHeight - MARGIN * 2);
        setSize({ w, h });
        setPos((p) => clampRect(p.x, p.y, w, h));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // 尺寸仅在本次会话内生效（不写 localStorage）：关闭/重开浮窗一律回到默认尺寸
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [size],
  );
  /* 尺寸变更不做任何持久化：仅当前会话生效，浮窗重开即回默认尺寸（见 initialSize / openFloat） */

  /* ---------- 标题栏拖动移动浮窗 ---------- */
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as Element).closest('button')) return; // 按钮不触发拖动
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const { x: x0, y: y0 } = pos;
      const onMove = (ev: PointerEvent): void => {
        setPos(clampRect(x0 + ev.clientX - startX, y0 + ev.clientY - startY, size.w, size.h));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [pos, size],
  );

  /* ---------- 自动滚动到底（stick-to-bottom）：流式长回答逐段增高也有跟随效果 ---------- */
  /* 0) 基础工具：scrollToBottom 标记 suppress，避免程序性滚动被 onBodyScroll 误判为"用户上滚" */
  const suppressScrollRef = useRef(false);
  const scrollToBottom = useCallback((smooth: boolean) => {
    const body = bodyRef.current;
    if (!body) return;
    suppressScrollRef.current = true;
    if (smooth) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    else body.scrollTop = body.scrollHeight;
    // smooth 滚动持续多帧，延迟解除；instant 下一帧解除即可
    window.setTimeout(
      () => {
        suppressScrollRef.current = false;
      },
      smooth ? 600 : 50,
    );
  }, []);

  /* 0b) 用户上滚暂停跟随、回到底部恢复。
        阈值取「离底 120px 或浮窗高度 1/4」的较小值：浮窗本身不高（约 400-600px），
        固定 80px 在流式追加时会因单帧增高被提前判定为"回到底部"。 */
  const onBodyScroll = useCallback(() => {
    if (suppressScrollRef.current) return;
    const body = bodyRef.current;
    if (!body) return;
    const threshold = Math.min(120, body.clientHeight / 4);
    stickRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < threshold;
  }, []);

  /* 1) 内容增高（消息变化 / 流式追加 / Markdown 布局 / 公式与图片就绪）→ 贴底时即时跟滚。
        ⚠️ 只在**贴底**状态跟滚：用户主动上滚查看历史时绝不打扰（stickRef 由 onBodyScroll 维护）。 */
  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!stickRef.current) return;
      const b = bodyRef.current;
      if (b) b.scrollTop = b.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [open]);

  /* 2) 打开浮窗 / 发送新消息：恢复贴底并平滑滚到底（仅在气泡数增加时，流式期间交给 RO 跟滚） */
  const lastMsgCountRef = useRef(0);
  useEffect(() => {
    if (!open) {
      lastMsgCountRef.current = 0;
      return;
    }
    const grew = messages.length > lastMsgCountRef.current;
    lastMsgCountRef.current = messages.length;
    if (!grew) return;
    stickRef.current = true;
    scrollToBottom(true);
  }, [messages.length, open, scrollToBottom]);

  /* ---------- 输入框：Enter 发送 / Shift+Enter 换行 ---------- */
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const text = input;
      setInput('');
      void send(text);
    }
  };

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* 关闭浮窗：视为结束本次对话，下次选词提问重新开始 */
  const closeFloat = useCallback(() => {
    setOpen(false);
    resetConversation();
  }, [resetConversation]);
  closeRef.current = closeFloat;

  const clearChat = resetConversation;

  /* ---------- 渲染 ---------- */
  if (!enabled) return null;

  const lastIsStreamingAssistant = streaming && messages[messages.length - 1]?.role === 'assistant';

  return (
    <>
      {/* 小卿气泡 Markdown 样式（unlayered 裸样式：岛内独立于全局 layer 体系，勿移入 @layer） */}
      <style>{`
.ai-md-body > :first-child { margin-top: 0; }
.ai-md-body > :last-child { margin-bottom: 0; }
.ai-md-body p { margin: 0.5em 0; }
.ai-md-body h1, .ai-md-body h2, .ai-md-body h3, .ai-md-body h4, .ai-md-body h5 { margin: 0.8em 0 0.4em; font-weight: 600; line-height: 1.35; }
.ai-md-body h1 { font-size: 1.25em; }
.ai-md-body h2 { font-size: 1.15em; }
.ai-md-body h3 { font-size: 1.05em; }
.ai-md-body h4, .ai-md-body h5 { font-size: 1em; }
.ai-md-body ul, .ai-md-body ol { margin: 0.5em 0; padding-left: 1.4em; }
.ai-md-body ul { list-style: disc; }
.ai-md-body ol { list-style: decimal; }
.ai-md-body li { margin: 0.2em 0; }
.ai-md-body pre { margin: 0.6em 0; padding: 0.7em 0.9em; border-radius: 0.5em; background: #0d1117; color: #e6edf3; overflow-x: auto; font-size: 0.85em; line-height: 1.55; }
.ai-md-body pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; border-radius: 0; }
.ai-md-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.875em; background: rgba(128,128,128,0.18); padding: 0.12em 0.35em; border-radius: 0.3em; }
.ai-md-body blockquote { margin: 0.5em 0; padding: 0.05em 0.9em; border-left: 3px solid rgba(128,128,128,0.45); opacity: 0.85; }
.ai-md-body a { color: var(--primary, #3b82f6); text-decoration: underline; text-underline-offset: 2px; }
.ai-md-body hr { border: 0; border-top: 1px solid rgba(128,128,128,0.3); margin: 0.8em 0; }
.ai-md-body table { border-collapse: collapse; margin: 0.6em 0; font-size: 0.9em; display: block; overflow-x: auto; }
.ai-md-body th, .ai-md-body td { border: 1px solid rgba(128,128,128,0.35); padding: 0.3em 0.6em; }
.ai-md-body img { max-width: 100%; border-radius: 0.4em; }
/* KaTeX：公式字号随气泡缩放，块级公式独立成行可横向滚动（长矩阵不撑破浮窗） */
.ai-md-body .katex { font-size: 1.05em; }
.ai-md-body .katex-display { margin: 0.7em 0; overflow-x: auto; overflow-y: hidden; padding: 0.2em 0; }
.ai-md-body .katex-error { color: #d33; }
.ai-md.ai-streaming .ai-md-body > :last-child::after { content: '▌'; margin-left: 1px; animation: ai-caret 1s step-end infinite; }
@keyframes ai-caret { 50% { opacity: 0; } }
      `}</style>

      {/* F2 右键菜单 */}
      {menu && (
        <div
          id="ai-context-menu"
          className="fixed z-[90] overflow-hidden rounded-md border border-border bg-background shadow-lg"
          style={{ left: `${Math.min(menu.x + 4, window.innerWidth - 140)}px`, top: `${Math.min(menu.y + 4, window.innerHeight - 48)}px` }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => openFloat(menu)}
          >
            <MessageCircle className="size-4 text-primary" />
            问问小卿
          </button>
        </div>
      )}

      {/* F3/F4/F5 悬浮对话框 */}
      {open && (
        <div
          id="ai-chat-float"
          role="dialog"
          aria-modal={false}
          aria-labelledby="ai-chat-float-title"
          className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.w}px`, height: `${size.h}px` }}
        >
          {/* 头部（拖动移动） */}
          <div
            className="flex cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 select-none"
            onPointerDown={startDrag}
          >
            <div className="min-w-0 flex-1">
              <p id="ai-chat-float-title" className="flex items-center gap-1.5 text-sm font-medium">
                <MessageCircle className="size-4 text-primary" />
                小卿
                {isOwner && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">主人</span>}
                {selectionCtx && <span className="truncate text-xs font-normal text-muted-foreground">· {selectionCtx.title}</span>}
              </p>
            </div>
            <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
              {streaming && (
                <button type="button" aria-label="停止生成" title="停止生成" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={stopStreaming}>
                  <Square className="size-3.5" />
                </button>
              )}
              <button type="button" aria-label="清空对话" title="清空对话" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={clearChat}>
                <Trash2 className="size-3.5" />
              </button>
              <button type="button" aria-label="关闭对话" title="关闭（结束本次对话）" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={closeFloat}>
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* 消息区（自动滚动：内容增高跟滚 + 发送后平滑到底 + 上滚暂停跟随） */}
          <div ref={bodyRef} onScroll={onBodyScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            <div ref={contentRef} className="space-y-3">
            {selectionCtx && messages.length === 0 && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">选中内容：{selectionCtx.text.slice(0, 120)}…</p>
            )}
            {messages.map((m, i) => {
              const isAssistant = m.role === 'assistant';
              const isEmptyPlaceholder = isAssistant && m.content === '';
              return (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground'
                        : `max-w-[90%] rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm break-words ${isEmptyPlaceholder ? '' : 'ai-md'}${streaming && isAssistant && i === messages.length - 1 ? ' ai-streaming' : ''}`
                    }
                  >
                    {isAssistant && m.content !== '' ? (
                      <div className="ai-md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                    ) : (
                      m.content
                    )}
                    {isEmptyPlaceholder && streaming && (
                      <span className="inline-block w-0.5 animate-pulse bg-foreground align-middle" style={{ height: '1em' }} />
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* 流式状态播报：读屏用户看不到光标动画与逐字输出，用 live region 补齐状态（P2-18） */}
          <p aria-live="polite" className="sr-only">
            {streaming ? '小卿正在回答' : ''}
          </p>

          {/* 输入区（F4：回答中可继续输入） */}
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={2}
                aria-label="追问内容"
                className="max-h-24 min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
                placeholder="继续追问…（Enter 发送，Shift+Enter 换行）"
                value={input}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={onInputKeyDown}
              />
              <button
                type="button"
                aria-label="发送"
                title="发送"
                className="shrink-0 rounded-md bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={input.trim() === ''}
                onClick={() => {
                  const text = input;
                  setInput('');
                  void send(text);
                }}
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>

          {/* F5 resize 手柄：右 / 下 / 右下 */}
          <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" onPointerDown={startResize('e')} />
          <div className="absolute bottom-0 left-0 h-1.5 w-full cursor-ns-resize" onPointerDown={startResize('s')} />
          <div className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize" onPointerDown={startResize('se')} />
        </div>
      )}
    </>
  );
}
