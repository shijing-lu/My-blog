/**
 * AiChatFloat.tsx —— AI 助手「小卿」悬浮交互（React 岛，BaseLayout 全站挂载 client:idle）
 *
 * 职责（对应开发计划 F2/F3/F4/F5）：
 * - F2 选中文本右键：捕获阶段监听 document contextmenu，白名单容器（.prose / #post-grid）
 *   内有选区时自绘「问问小卿」菜单；白名单外与未启用时放行浏览器原生菜单；
 * - F3 悬浮框：鼠标附近 clamp 定位弹出，自动把选中文字模板化为首条消息发送，SSE 流式渲染；
 * - F4 多轮追问：messages 累积，回答中可继续输入，新发送时 abort 旧流（保留已生成文本）；
 * - F5 可调整大小：右/下/右下三向自绘手柄拖拽 resize，尺寸持久化 localStorage；
 * - 附加：标题栏拖动移动浮窗、Esc 关闭、ClientRouter 转场经 sessionStorage 恢复对话记录。
 *
 * SSE 帧格式（服务端 /api/ai/chat 重帧）：data: {"delta":"…"} / {"error":"…"} / {"done":true}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Square, Trash2, X } from 'lucide-react';

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

const WHITELIST_SELECTOR = '.prose, #post-grid';
const MAX_SELECTION_CHARS = 2000;
const MIN_W = 320;
const MIN_H = 360;
const DEFAULT_W = 380;
const DEFAULT_H = 480;
const MARGIN = 12;

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

/** 读取持久化尺寸（损坏/越界回落默认） */
function loadSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { w?: number; h?: number };
      const w = Math.min(Math.max(MIN_W, Number(s.w) || DEFAULT_W), window.innerWidth - MARGIN * 2);
      const h = Math.min(Math.max(MIN_H, Number(s.h) || DEFAULT_H), window.innerHeight - MARGIN * 2);
      return { w, h };
    }
  } catch {
    /* 忽略 */
  }
  return { w: DEFAULT_W, h: DEFAULT_H };
}

/** 页面标题去站点后缀（「xxx · 站名」→「xxx」） */
function pageTitle(): string {
  const t = document.title || '';
  const idx = t.lastIndexOf(' · ');
  return (idx > 0 ? t.slice(0, idx) : t).trim();
}

/** 首条消息模板：把选中文字模板化为解释请求 */
function buildFirstMessage(text: string, title: string): string {
  return `请解释/分析以下我选中的内容（来自「${title}」）：\n"""\n${text}\n"""`;
}

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
  /** 输入框聚焦标记：流式追加时用户正在输入则不强制滚动到底 */
  const inputFocusedRef = useRef(false);
  /** 最新消息快照（send 组装历史用，避免在 setState updater 里做副作用） */
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ---------- 会话恢复 + 尺寸恢复（ClientRouter 转场岛重建后执行） ---------- */
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = sessionStorage.getItem(MESSAGES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'));
        }
      }
    } catch {
      /* 忽略 */
    }
    setSize(loadSize());
    return () => abortRef.current?.abort();
  }, [enabled]);

  /* ---------- 消息变更同步 sessionStorage ---------- */
  useEffect(() => {
    if (!enabled) return;
    try {
      if (messages.length > 0) sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
      else sessionStorage.removeItem(MESSAGES_KEY);
    } catch {
      /* 存储满/隐私模式忽略 */
    }
  }, [messages, enabled]);

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

  /* ---------- F2：捕获阶段 contextmenu，白名单容器内选区 → 自绘菜单 ---------- */
  useEffect(() => {
    if (!enabled) return;
    // 水合完成标记（E2E 依赖：client:idle 水合晚于页面 load）
    document.documentElement.dataset.aiFloatReady = '1';
    const onContextMenu = (e: MouseEvent): void => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (text === '') return;
      const anchor = sel?.anchorNode;
      const el = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null);
      if (!el?.closest(WHITELIST_SELECTOR)) return; // 白名单外放行原生菜单
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
        setOpen(false);
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

  /* ---------- 菜单点击 → 弹出浮窗 + 自动发送选中文字 ---------- */
  const openFloat = useCallback(
    (m: MenuState) => {
      setMenu(null);
      setSelectionCtx({ text: m.text, title: m.title });
      const { w, h } = size;
      // 鼠标附近弹出：右侧优先，放不下翻转左侧，统一 clamp
      const flipX = m.x + MARGIN + w > window.innerWidth;
      const p = clampRect(flipX ? m.x - w - MARGIN : m.x + MARGIN, m.y + MARGIN, w, h);
      setPos(p);
      setOpen(true);
      void send(buildFirstMessage(m.text, m.title));
    },
    [size, send],
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
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        } catch {
          /* 忽略 */
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [size],
  );
  // size 变化结束后持久化（避免闭包旧值）
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
      /* 忽略 */
    }
  }, [size, open]);

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

  /* ---------- 消息区自动滚动到底（输入聚焦时不打扰） ---------- */
  useEffect(() => {
    if (!open || inputFocusedRef.current) return;
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, open]);

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

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSelectionCtx(null);
  }, []);

  /* ---------- 渲染 ---------- */
  if (!enabled) return null;

  const lastIsStreamingAssistant = streaming && messages[messages.length - 1]?.role === 'assistant';

  return (
    <>
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
          className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.w}px`, height: `${size.h}px` }}
        >
          {/* 头部（拖动移动） */}
          <div
            className="flex cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 select-none"
            onPointerDown={startDrag}
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <MessageCircle className="size-4 text-primary" />
                小卿
                {selectionCtx && <span className="truncate text-xs font-normal text-muted-foreground">· {selectionCtx.title}</span>}
              </p>
            </div>
            <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
              {streaming && (
                <button type="button" title="停止生成" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={stopStreaming}>
                  <Square className="size-3.5" />
                </button>
              )}
              <button type="button" title="清空对话" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={clearChat}>
                <Trash2 className="size-3.5" />
              </button>
              <button type="button" title="关闭" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={() => setOpen(false)}>
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* 消息区 */}
          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
            {selectionCtx && messages.length === 0 && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">选中内容：{selectionCtx.text.slice(0, 120)}…</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground'
                      : 'max-w-[90%] rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap break-words'
                  }
                >
                  {m.content}
                  {m.role === 'assistant' && m.content === '' && streaming && <span className="inline-block w-0.5 animate-pulse bg-foreground align-middle" style={{ height: '1em' }} />}
                </div>
              </div>
            ))}
          </div>

          {/* 输入区（F4：回答中可继续输入） */}
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                className="max-h-24 min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
                placeholder="继续追问…（Enter 发送，Shift+Enter 换行）"
                value={input}
                onFocus={() => (inputFocusedRef.current = true)}
                onBlur={() => (inputFocusedRef.current = false)}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={onInputKeyDown}
              />
              <button
                type="button"
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
