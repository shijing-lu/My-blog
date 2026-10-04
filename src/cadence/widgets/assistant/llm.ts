import { z } from "zod";
import type { AssistantTool, ParseResult } from "./types";

export async function pickToolViaLlm(
  text: string,
  tools: readonly AssistantTool[],
): Promise<ParseResult> {
  const response = await fetch("/api/cadence/assistant", {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.params, { unrepresentable: "any" }),
        },
      })),
    }),
  });
  if (!response.ok) throw new Error("智能理解暂不可用");
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  const calls = message?.tool_calls ?? [];
  if (calls.length > 1)
    return {
      tool: undefined,
      reason: "ambiguous",
      summary: "请一次描述一个操作。",
    };
  const call = calls[0];
  if (!call)
    return {
      tool: undefined,
      reason: "ambiguous",
      summary: message?.content?.trim() || "请补充要执行的操作。",
    };
  if (!tools.some((tool) => tool.name === call.function.name))
    throw new Error("返回了不支持的操作");
  const args: unknown = JSON.parse(call.function.arguments);
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("参数格式不正确");
  return {
    tool: call.function.name,
    args: args as Record<string, unknown>,
    via: "llm",
    summary: "已理解操作，正在校验参数",
  };
}
