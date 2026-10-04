/**
 * AI 助手 · 执行编排器
 * ---------------------------------------------------------------------------
 * 一条指令的完整旅程：解析（本地规则 → LLM 兜底）→ 参数校验（Zod）
 * → 删除类拦截（等确认）→ 执行（现有用例层）→ 结果如实回告。
 * 这里是六条铁律的**代码强制点**：解析器只是建议，这里的闸门说了算。
 */

import { assistantConfig } from "@/cadence/shared/store/assistant-store";
import {
  CAPABILITY_SUMMARY,
  isParsed,
  type AssistantTool,
  type ParseResult,
} from "./types";
import { pickToolViaLlm } from "./llm";
import { parseLocal, splitItemList } from "./local-parser";
import { TOOLS, toolByName } from "./tools";

export type AssistantOutcome =
  | { kind: "done"; message: string }
  | {
      kind: "confirm";
      tool: string;
      args: Record<string, unknown>;
      message: string;
    }
  | { kind: "clarify"; message: string };

async function parse(text: string): Promise<ParseResult> {
  const local = parseLocal(text);
  if (isParsed(local)) return local;
  const { llmEnabled } = assistantConfig();
  if (llmEnabled) {
    try {
      return await pickToolViaLlm(text, TOOLS);
    } catch {
      // LLM 不可用（没配 / 网络 / CORS）→ 本地规则兜底，不打断用户
      return local;
    }
  }
  return local;
}

/**
 * LLM 参数纠偏
 * ---------------------------------------------------------------------------
 * LLM 常见的手误是**类型错误**：该给数组给成字符串、该给数字给成 "2"。
 * 这不是用户表达的问题，不该让用户"再说一次" —— 在校验前按工具声明的
 * Schema 形状做一次确定性纠正：
 *   - 期望数组 ← 字符串：按清单分隔符切开（与本地规则同一套语义）
 *   - 期望数字 ← 数字字符串："2" → 2
 *   - 期望布尔 ← "true"/"false"
 * 纠不正的照旧失败，交回退流程处理。
 *
 * 类型探测用 zod v4 的 `_zod.def.type`（optional 先解包 innerType）。
 */
function coerceArgs(
  tool: AssistantTool,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const shape = (
    tool.params as unknown as {
      shape?: Record<
        string,
        {
          _zod?: {
            def?: {
              type?: string;
              innerType?: { _zod?: { def?: { type?: string } } };
            };
          };
        }
      >;
    }
  ).shape;
  if (shape === undefined) return args;

  const next: Record<string, unknown> = { ...args };
  for (const [key, field] of Object.entries(shape)) {
    const value = next[key];
    if (value === undefined) continue;

    let type = field._zod?.def?.type;
    if (type === "optional") {
      type = field._zod?.def?.innerType?._zod?.def?.type;
    }

    if (typeof value !== "string") continue;
    if (type === "array") {
      const items = splitItemList(value);
      if (items.length > 0) next[key] = items;
    } else if (
      type === "number" &&
      value.trim() !== "" &&
      !Number.isNaN(Number(value))
    ) {
      next[key] = Number(value);
    } else if (type === "boolean" && (value === "true" || value === "false")) {
      next[key] = value === "true";
    }
  }
  return next;
}

/** 宿主能力（UI 层注入）：目前只有页面跳转 */
export interface HostIo {
  navigate: (to: string) => Promise<unknown>;
}

const NOOP_IO: HostIo = { navigate: () => Promise.resolve() };

/** 执行一条用户指令（破坏性工具会停在 confirm，等用户点头后才 executeConfirmed） */
export async function runCommand(
  text: string,
  now: number,
  io: HostIo = NOOP_IO,
): Promise<AssistantOutcome> {
  const parsed = await parse(text);

  // R5：无法确定意图 → 能力清单 / LLM 的反问原样转达，绝不猜
  if (!isParsed(parsed)) {
    if (parsed.reason === "ambiguous" && parsed.summary !== undefined) {
      return { kind: "clarify", message: parsed.summary };
    }
    if (parsed.reason === "ambiguous") {
      return {
        kind: "clarify",
        message:
          "这句话可以理解成几种操作（比如既像建计划又像记待办）。请只说其中一件，我一次只做一件事。",
      };
    }
    if (parsed.missingParam !== undefined) {
      return {
        kind: "clarify",
        message: `还差一个信息：${parsed.missingParam}`,
      };
    }
    return {
      kind: "clarify",
      message: `这个我做不到。目前能做：\n${CAPABILITY_SUMMARY.join("\n")}`,
    };
  }

  const tool = toolByName(parsed.tool);
  if (tool === undefined) {
    return { kind: "clarify", message: `内部错误：未知工具 ${parsed.tool}` };
  }

  // R3 的代码强制：参数必须通过工具声明的 Zod 校验。
  // 第一遍失败 → 先做确定性纠偏（LLM 的类型手误）；仍失败且来自 LLM →
  // 回退本地规则重新解析（本地路由对同一句话的理解更可控）；两路都不行才问用户。
  const firstCheck = tool.params.safeParse(parsed.args);
  if (firstCheck.success) {
    return await finishCommand(
      tool,
      parsed.summary,
      firstCheck.data as Record<string, unknown>,
      now,
      io,
    );
  }

  const coerced = tool.params.safeParse(coerceArgs(tool, parsed.args));
  if (coerced.success) {
    return await finishCommand(
      tool,
      parsed.summary,
      coerced.data as Record<string, unknown>,
      now,
      io,
    );
  }

  if (parsed.via === "llm") {
    const local = parseLocal(text);
    if (isParsed(local) && local.tool === parsed.tool) {
      const localCheck = tool.params.safeParse(local.args);
      if (localCheck.success) {
        return await finishCommand(
          tool,
          local.summary,
          localCheck.data as Record<string, unknown>,
          now,
          io,
        );
      }
    }
  }

  const issue = firstCheck.error.issues[0];
  return {
    kind: "clarify",
    message: `这条指令我没能可靠地解析（${issue?.path.join(".") ?? "参数"}不符合要求）。换个简单的说法试试，例如：制定今天的计划：写周报、回邮件。`,
  };
}

/** 校验通过后的收尾：确认分流 + 执行 */
async function finishCommand(
  tool: AssistantTool,
  summary: string,
  args: Record<string, unknown>,
  now: number,
  io: HostIo,
): Promise<AssistantOutcome> {
  // R4：删除类必须确认，绝不直接执行
  if (tool.destructive) {
    return {
      kind: "confirm",
      tool: tool.name,
      args,
      message: `这会删除数据（进回收站，30 天内可恢复）。确认执行「${summary}」吗？`,
    };
  }
  return executeConfirmed(tool.name, args, now, io);
}

/** 确认后的实际执行（UI 的确认按钮也走这里 —— 与首次执行同一条校验链） */
export async function executeConfirmed(
  toolName: string,
  args: Record<string, unknown>,
  now: number,
  io: HostIo = NOOP_IO,
): Promise<AssistantOutcome> {
  const tool = toolByName(toolName);
  if (tool === undefined)
    return { kind: "clarify", message: `内部错误：未知工具 ${toolName}` };

  // 确认后的参数重校验：确认弹窗打开期间数据可能已变化（R6：不粉饰）
  const checked = tool.params.safeParse(args);
  if (!checked.success) {
    return {
      kind: "clarify",
      message: "刚才的目标似乎已经变了（找不到了），请重新说一次。",
    };
  }

  try {
    const message = await tool.execute(checked.data as never, {
      now,
      navigate: io.navigate,
    });
    return { kind: "done", message };
  } catch (error: unknown) {
    // 用例层抛出的都是"用户能看懂"的业务错误（找不到/重名/约束），如实转达
    return {
      kind: "clarify",
      message: error instanceof Error ? error.message : "执行失败，请重试",
    };
  }
}
