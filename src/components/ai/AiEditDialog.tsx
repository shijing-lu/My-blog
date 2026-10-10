import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, Square, Undo2, X } from "lucide-react";
import {
  activeAiEditor,
  type AiEditorTarget,
  type FrozenAiSelection,
} from "../../lib/ai-editor-bridge";
import { readSseData } from "../../lib/ai-stream";

interface Message {
  role: "user" | "assistant";
  content: string;
}
interface Ready {
  runId?: string;
  candidate?: string;
  scope?: string;
  discussion?: boolean;
  question?: string;
}
export default function AiEditDialog() {
  const dialog = useRef<HTMLDialogElement>(null),
    targetRef = useRef<AiEditorTarget | null>(null);
  const selectionRef = useRef<FrozenAiSelection | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [skill, setSkill] = useState(""),
    [scope, setScope] = useState("document"),
    [candidate, setCandidate] = useState("");
  const [lastRun, setLastRun] = useState("");
  const [runs, setRuns] = useState<
      Array<{ id: string; status: string; createdAt: string }>
    >([]),
    [showHistory, setShowHistory] = useState(false);
  const [sources, setSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          target: AiEditorTarget;
          selection?: FrozenAiSelection;
        }>
      ).detail;
      if (!detail?.target || abortRef.current) return;
      const same = targetRef.current === detail.target && !detail.selection;
      if (same && dialog.current?.open && !selectionRef.current) {
        dialog.current.close();
        setOpen(false);
        return;
      }
      targetRef.current = detail.target;
      if (!same) {
        selectionRef.current = detail.selection;
        setScope(detail.selection ? "selection" : "document");
        setMessages([]);
        setCandidate("");
        setLastRun("");
        setShowHistory(false);
        setRuns([]);
        setSources([]);
      }
      setOpen(true);
      setStatus("");
    };
    const editorChanged = () => {
      if (abortRef.current && activeAiEditor() !== targetRef.current) {
        abortRef.current.abort();
        setStatus("编辑会话已切换，本轮停止，原文未覆盖");
      }
    };
    const navigating = () => {
      abortRef.current?.abort();
      dialog.current?.close();
      setOpen(false);
    };
    window.addEventListener("ai:edit-open", show);
    window.addEventListener("ai:editor-change", editorChanged);
    document.addEventListener("astro:before-preparation", navigating);
    return () => {
      window.removeEventListener("ai:edit-open", show);
      window.removeEventListener("ai:editor-change", editorChanged);
      document.removeEventListener("astro:before-preparation", navigating);
      abortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    if (node.open && (scope === "selection") !== node.matches(":modal"))
      node.close();
    if (!node.open) {
      if (scope === "selection") node.showModal();
      else node.show();
    }
  }, [open, scope]);
  const close = () => {
    if (busy) {
      abortRef.current?.abort();
      return;
    }
    dialog.current?.close();
    setOpen(false);
  };
  const commit = async (
    runId: string,
    source: string,
    baseline: string,
    target: AiEditorTarget,
  ) => {
    if (activeAiEditor() !== target || target.source() !== baseline)
      throw new Error(
        "生成期间文章发生变化，候选内容已保留，请重新发起，原文未覆盖",
      );
    if (!(await target.flush()) || target.source() !== baseline)
      throw new Error("保存期间文章发生变化，请重新发起");
    target.lock(true);
    try {
      if (activeAiEditor() !== target || target.source() !== baseline)
        throw new Error("编辑会话已变化");
      const save = () =>
        fetch("/api/ai/edit", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId, content: source }),
          signal: AbortSignal.timeout(30000),
        });
      let response: Response;
      // A lost acknowledgement can be retried with the same idempotent run ID.
      try {
        response = await save();
      } catch {
        response = await save();
      }
      const data = (await response.json()) as {
        error?: string;
        content: string;
        contentHash?: string;
      };
      if (!response.ok) throw new Error(data.error || "保存失败");
      if (activeAiEditor() === target)
        target.apply(data.content, data.contentHash);
      return data.content;
    } finally {
      target.lock(false);
    }
  };
  const send = async () => {
    const instruction = input.trim(),
      target = targetRef.current;
    if (!instruction || !target || busy) return;
    setBusy(true);
    setStatus("保存当前正文…");
    setCandidate("");
    const abort = new AbortController();
    abortRef.current = abort;
    let ready: Ready | undefined,
      answer = "";
    const history = messages
      .slice(-12)
      .map((message) => ({
        ...message,
        content: message.content.slice(0, 12000),
      }));
    setMessages((prev) => [
      ...prev,
      { role: "user", content: instruction },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    try {
      if (activeAiEditor() !== target)
        throw new Error("请返回该文章的编辑模式后再使用 AI");
      if (!(await target.flush()))
        throw new Error("当前正文保存失败，请先处理保存问题");
      const baseline = target.source(),
        selection = selectionRef.current;
      if (selection && baseline !== selection.source)
        throw new Error("选区冻结后正文已变化，请重新选中文字");
      setStatus("AI 正在读取和处理…");
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          domain: target.domain,
          targetId: target.targetId,
          source: baseline,
          instruction,
          history,
          skill: skill || undefined,
          scope: selection ? "selection" : "document",
          selection: selection?.text,
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "AI 编辑服务不可用");
      }
      for await (const frame of readSseData(response.body)) {
        const data = JSON.parse(frame) as {
          delta?: string;
          tool?: string;
          error?: string;
          ready?: Ready;
          progress?: { current: number; total: number };
          source?: { title: string; url: string };
        };
        if (data.error) throw new Error(data.error);
        if (data.tool) setStatus(`正在处理：${data.tool}`);
        if (data.progress)
          setStatus(
            `按完整结构整理：第 ${data.progress.current}/${data.progress.total} 段`,
          );
        if (data.source)
          setSources((prev) =>
            prev.some((s) => s.url === data.source!.url)
              ? prev
              : [...prev, data.source!],
          );
        if (data.delta) {
          answer += data.delta;
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1
                ? { role: "assistant", content: answer }
                : m,
            ),
          );
        }
        if (data.ready) ready = data.ready;
      }
      if (!ready) throw new Error("连接结束但未收到完整结果，原文未修改");
      if (ready.question) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1
              ? { role: "assistant", content: ready!.question! }
              : m,
          ),
        );
        setStatus("请补充后继续");
        return;
      }
      if (ready.runId && typeof ready.candidate === "string") {
        const full = selection
          ? selection.project(ready.candidate)
          : ready.candidate;
        setCandidate(full);
        setStatus("校验并保存修改…");
        if (abort.signal.aborted) throw new Error("已停止，原文未修改");
        const applied = await commit(ready.runId, full, baseline, target);
        if (selection)
          selectionRef.current = {
            ...selection,
            source: applied,
            text: ready.candidate,
          };
        setLastRun(ready.runId);
        setCandidate("");
        setStatus("已替换并保存，可撤销");
      } else setStatus("回答完成，正文未修改");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "AI 编辑失败");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };
  const undo = async () => {
    const target = targetRef.current;
    if (!target || busy || !lastRun) return;
    setBusy(true);
    setStatus("恢复修改前正文…");
    try {
      if (activeAiEditor() !== target || !(await target.flush()))
        throw new Error("请返回该文章并保存当前正文");
      const baseline = target.source();
      target.lock(true);
      try {
        const response = await fetch("/api/ai/edit", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId: lastRun }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "恢复失败");
        if (target.source() !== baseline)
          throw new Error("本机正文已变化，请重新读取");
        target.apply(data.content, data.contentHash);
        setLastRun("");
        selectionRef.current = undefined;
        setScope("document");
        setStatus("已恢复并保存");
      } finally {
        target.lock(false);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };
  const readHistory = async (runId?: string) => {
    const target = targetRef.current;
    if (!target) return;
    try {
      const query = new URLSearchParams({
        domain: target.domain,
        targetId: target.targetId,
        ...(runId ? { runId } : {}),
      });
      const response = await fetch(`/api/ai/edit?${query}`, {
          cache: "no-store",
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取历史失败");
      if (runId) {
        const run = data.runs[0];
        if (!run) throw new Error("记录不存在");
        setCandidate(run.before);
        setLastRun(run.status === "committed" ? run.id : "");
        setStatus(
          "已显示修改前的完整快照。撤销只会在当前正文仍等于该次 AI 结果时应用。",
        );
      } else {
        setRuns(data.runs);
        setShowHistory(true);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "读取历史失败");
    }
  };
  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="ai-edit-dialog"
      aria-labelledby="ai-article-editor-title"
      data-docked={scope === "document" ? "true" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="ai-edit-head">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} />
          <strong id="ai-article-editor-title">
            {scope === "selection" ? "AI 编辑选区" : "AI 文章助手"}
          </strong>
        </div>
        <button type="button" aria-label="关闭" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="ai-edit-options">
        <select
          aria-label="整理技能"
          value={skill}
          disabled={busy}
          onChange={(e) => setSkill(e.target.value)}
        >
          <option value="">按任务选择技能</option>
          <option value="note-normalizer">通用笔记整理</option>
          <option value="my-blog-structured-notes">结构化学习笔记</option>
        </select>
        <span>
          {scope === "selection"
            ? "只修改选中文字"
            : "读取当前最新全文，可按需搜索站内资料"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void readHistory()}
        >
          修改历史
        </button>
      </div>
      {showHistory && (
        <div className="ai-edit-history">
          {runs.length ? (
            runs.map((run) => (
              <button
                type="button"
                key={run.id}
                disabled={busy}
                onClick={() => void readHistory(run.id)}
              >
                {run.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                {run.status === "committed"
                  ? "已保存"
                  : run.status === "undone"
                    ? "已撤销"
                    : "待应用"}{" "}
                · 查看原文
              </button>
            ))
          ) : (
            <span>暂无修改记录</span>
          )}
        </div>
      )}
      {selectionRef.current && (
        <details className="ai-edit-candidate">
          <summary>已选中的原文</summary>
          <textarea
            readOnly
            aria-label="已选原文"
            value={selectionRef.current.text}
          />
        </details>
      )}
      {sources.length > 0 && (
        <div className="ai-edit-options">
          参考来源：
          {sources.map((s) => (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              key={s.url}
              className="text-primary underline"
            >
              {s.title}
            </a>
          ))}
        </div>
      )}
      <div className="ai-edit-messages">
        {messages.length === 0 ? (
          <p className="text-muted-foreground">
            告诉小卿你想怎样修改。也可以先讨论内容；明确要求修改后会自动替换并保存。
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`ai-edit-message ai-edit-${m.role}`}>
              <span className="text-xs text-muted-foreground">
                {m.role === "user" ? "你" : "小卿"}
              </span>
              <div>{m.content || "正在处理…"}</div>
            </div>
          ))
        )}
      </div>
      {candidate && (
        <details className="ai-edit-candidate">
          <summary>未应用的候选正文</summary>
          <textarea readOnly aria-label="候选 Markdown" value={candidate} />
        </details>
      )}
      <div className="ai-edit-status" role="status">
        {status}
        {lastRun && !busy && (
          <button onClick={() => void undo()}>
            <Undo2 size={14} /> 撤销本次修改
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="ai-edit-input"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="例如：使用笔记整理技能整理全文，保留所有原有知识…"
          aria-label="AI 编辑要求"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="停止生成"
          >
            <Square size={18} />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} aria-label="发送">
            <Send size={18} />
          </button>
        )}
      </form>
    </dialog>,
    document.body,
  );
}
