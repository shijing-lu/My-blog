/**
 * AI 助手面板
 * ---------------------------------------------------------------------------
 * 悬浮球 + 对话面板（固定右下角，不随路由消失）。
 * 面板只负责：输入、消息流、破坏性操作的确认按钮；一切执行走 run.ts。
 *
 * 边界的最后一段代码在这里：确认按钮调用 executeConfirmed 而不是直接碰工具，
 * 保证"确认后执行"与"首次执行"过的是同一条参数校验链。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { executeConfirmed, runCommand, type AssistantOutcome } from "./run";
import { CAPABILITY_SUMMARY } from "./types";
import { AnimatePresence, m } from "@/cadence/shared/motion";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

interface ChatItem {
  id: number;
  role: "user" | "assistant";
  text: string;
}

let seq = 0;

export function AssistantPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<
    { tool: string; args: Record<string, unknown> } | undefined
  >(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const push = (role: ChatItem["role"], text: string) => {
    seq += 1;
    setMessages((prev) => [...prev, { id: seq, role, text }]);
  };

  const deliver = (outcome: AssistantOutcome) => {
    if (outcome.kind === "done") {
      push("assistant", outcome.message);
      setPending(undefined);
    } else if (outcome.kind === "clarify") {
      push("assistant", outcome.message);
      setPending(undefined);
    } else {
      push("assistant", outcome.message);
      setPending({ tool: outcome.tool, args: outcome.args });
    }
  };

  const send = () => {
    const text = input.trim();
    if (text.length === 0 || busy) return;
    push("user", text);
    setInput("");
    setBusy(true);
    void runCommand(text, Date.now(), {
      navigate: (to) => router.navigate({ to }),
    })
      .then(deliver)
      .catch(() => push("assistant", "出了点问题，请重试"))
      .finally(() => setBusy(false));
  };

  const confirmPending = () => {
    if (pending === undefined || busy) return;
    setBusy(true);
    void executeConfirmed(pending.tool, pending.args, Date.now(), {
      navigate: (to) => router.navigate({ to }),
    })
      .then(deliver)
      .catch(() => push("assistant", "出了点问题，请重试"))
      .finally(() => setBusy(false));
  };

  return (
    <>
      {/* 悬浮球 */}
      <button
        data-m3-role="fab"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "关闭助手" : "打开 AI 助手"}
        className="craft-transition-fast fixed right-5 bottom-24 z-[var(--z-drawer)] grid place-items-center rounded-full bg-primary text-primary-foreground md:bottom-5"
        style={{ height: 52, width: 52 }}
      >
        <MaterialIcon name="auto_awesome"><svg
          viewBox="0 0 24 24"
          width={22}
          height={22}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 3c-4.4 0-8 3-8 6.8 0 2.1 1.1 4 2.9 5.2L6 20l3.6-1.8c.8.2 1.6.3 2.4.3 4.4 0 8-3 8-6.8S16.4 3 12 3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="10" r="1" fill="currentColor" />
          <circle cx="12" cy="10" r="1" fill="currentColor" />
          <circle cx="15" cy="10" r="1" fill="currentColor" />
        </svg></MaterialIcon>
      </button>

      {/* 对话面板 */}
      <AnimatePresence>
        {open ? (
          <m.div
            data-m3-role="dialog"
            key="assistant-panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="surface-card fixed right-5 bottom-[152px] z-[var(--z-drawer)] flex w-[min(400px,92vw)] flex-col overflow-hidden md:bottom-[88px]"
            style={{
              height: "min(480px, calc(100dvh - 180px))",
              borderRadius: "var(--radius-hand-lg)",
            }}
            role="dialog"
            aria-label="AI 助手"
          >
            <header data-m3-role="panel-header" className="border-b border-[var(--color-paper-line)] px-5 pt-4 pb-3">
              <h3 className="text-ink-1 font-serif text-[15px]">助手</h3>
              <p className="text-ink-4 mt-0.5 text-[11px]">
                一次只做一件事 · 删除类操作需确认 · 说不清的会反问
              </p>
            </header>

            <div
              ref={listRef}
              className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
            >
              {messages.length === 0 ? (
                <div className="text-ink-3 space-y-2 text-[12.5px] leading-relaxed">
                  <p>用一句话让我替你操作，比如：</p>
                  <ul className="text-ink-2 space-y-1 pl-4">
                    <li>· 制定一个计划：季度复盘</li>
                    <li>· 给季度复盘添加任务：整理执行记录</li>
                    <li>· 记一条待办：交水电费，放在紧急不重要</li>
                    <li>· 开始专注：写周报 / 结束专注</li>
                    <li>· 写复盘：跑通了数据层，心情4</li>
                    <li>· 打开复盘 / 切换成墨夜 / 今天怎么样</li>
                  </ul>
                  <p className="text-ink-4 text-[11px]">
                    能力边界：{"\n" + CAPABILITY_SUMMARY.join("\n")}
                  </p>
                </div>
              ) : (
                messages.map((item) => (
                  <div
                    key={item.id}
                    className={[
                      "max-w-[85%] rounded-[var(--radius-hand-sm)] px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap",
                      item.role === "user"
                        ? "bg-amber-soft text-ink-1 ml-auto"
                        : "surface-inset text-ink-1",
                    ].join(" ")}
                  >
                    {item.text}
                  </div>
                ))
              )}

              {pending !== undefined ? (
                <div className="surface-inset flex items-center gap-2 rounded-[var(--radius-hand-sm)] p-2.5">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={confirmPending}
                    loading={busy}
                  >
                    确认删除
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPending(undefined);
                      push("assistant", "已取消，什么都没动");
                    }}
                  >
                    取消
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="border-t border-[var(--color-paper-line)] p-3.5">
              <div className="flex items-end gap-2">
                <TextField
                  label="对助手说"
                  hideLabel
                  value={input}
                  multiline
                  rows={1}
                  placeholder="想做什么，一句话"
                  className="flex-1"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <Button size="sm" onClick={send} loading={busy}>
                  发送
                </Button>
              </div>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
