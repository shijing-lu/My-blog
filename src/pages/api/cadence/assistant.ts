import type { APIRoute } from "astro";
import { z } from "zod";
import { isCadenceOwner } from "@/lib/cadence-access";
import { getAiConfig, isAiReady, buildChatUrl } from "@/lib/ai-config";
import { BEHAVIOR_RULES } from "@/cadence/widgets/assistant/types";
import { json } from "@/lib/api";
export const prerender = false;

const toolNames = new Set([
  "plan_create",
  "plan_update",
  "plan_set_status",
  "plan_delete",
  "task_create",
  "task_create_sub",
  "task_set_status",
  "task_note",
  "task_delete",
  "todo_create",
  "todo_move",
  "todo_set_status",
  "todo_delete",
  "focus_start",
  "focus_stop",
  "review_schedule_create",
  "review_entry_write",
  "daily_plan_set",
  "daily_plan_add",
  "daily_plan_add_task",
  "daily_plan_remove",
  "daily_plan_done",
  "daily_plan_report",
  "daily_plan_promote",
  "daily_plan_focus",
  "schedule_create",
  "schedule_rename",
  "schedule_move",
  "schedule_resize",
  "schedule_complete",
  "schedule_delete",
  "schedule_report",
  "countdown_create",
  "countdown_adjust",
  "countdown_pause",
  "countdown_remove",
  "countdown_report",
  "navigate",
  "theme_set",
  "overview_report",
]);
const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string().refine((name) => toolNames.has(name)),
          description: z.string().max(2000),
          parameters: z.record(z.string(), z.unknown()),
        }),
      }),
    )
    .min(1)
    .max(40),
});
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};
const reply = (error: string, status: number) =>
  json({ error }, { status, headers });

export const POST: APIRoute = async ({ cookies, request, url }) => {
  if (!(await isCadenceOwner(cookies)))
    return reply("仅博客所有者可使用日程助手", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return reply("请求来源不合法", 403);
  try {
    const raw = await request.text();
    if (raw.length > 180000) return reply("请求内容过大", 413);
    const parsed = bodySchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      new Set(parsed.data.tools.map((t) => t.function.name)).size !==
        parsed.data.tools.length
    )
      return reply("请求参数不合法", 400);
    const config = await getAiConfig();
    if (!isAiReady(config)) return reply("请先在博客后台配置 AI 服务", 503);
    const upstream = await fetch(buildChatUrl(config.baseUrl), {
      method: "POST",
      signal: AbortSignal.timeout(25000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        parallel_tool_calls: false,
        messages: [
          { role: "system", content: BEHAVIOR_RULES.join("\n") },
          { role: "user", content: parsed.data.text },
        ],
        tools: parsed.data.tools,
      }),
    });
    if (!upstream.ok) return reply("AI 服务暂不可用", 502);
    const data = (await upstream.json()) as {
      choices?: Array<{
        message?: { content?: unknown; tool_calls?: unknown[] };
      }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message || (message.tool_calls?.length ?? 0) > 1)
      return reply("请一次描述一个操作", 422);
    return json(
      {
        choices: [
          {
            message: {
              content:
                typeof message.content === "string" ? message.content : null,
              tool_calls: message.tool_calls ?? [],
            },
          },
        ],
      },
      { headers },
    );
  } catch (e) {
    return reply(
      e instanceof SyntaxError
        ? "请求参数不合法"
        : "智能理解暂不可用，可继续使用基础指令",
      e instanceof SyntaxError ? 400 : 503,
    );
  }
};
