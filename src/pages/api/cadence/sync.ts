import type { APIRoute } from "astro";
import { z } from "zod";
import { json } from "@/lib/api";
import { isCadenceOwner } from "@/lib/cadence-access";
import { cadenceStore } from "@/lib/cadence-store";
import { PayloadSchemas } from "@/cadence/data/db/validation";
import { SYNC_TABLES, SYNC_VERSION, payloadId } from "@/cadence/sync/protocol";
export const prerender = false;
const reply = (data: unknown, status = 200) =>
  json(data, { status, headers: { "cache-control": "private, no-store" } });
const schema = z.object({
  schemaVersion: z.literal(SYNC_VERSION),
  changes: z
    .array(
      z.object({
        table: z.enum(SYNC_TABLES),
        recordId: z.string().min(1).max(300),
        baseRevision: z.string().max(100).nullable(),
        payload: z.record(z.string(), z.unknown()).nullable(),
      }),
    )
    .max(250),
});
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isCadenceOwner(cookies)))
    return reply({ error: "日程仅站主可访问" }, 403);
  try {
    return reply({
      schemaVersion: SYNC_VERSION,
      records: await cadenceStore().list(),
    });
  } catch {
    return reply(
      { error: "日程服务端暂不可用，请确认云库迁移和连接；本地数据仍已保存" },
      503,
    );
  }
};
export const POST: APIRoute = async ({ cookies, request }) => {
  if (!(await isCadenceOwner(cookies)))
    return reply({ error: "日程仅站主可访问" }, 403);
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return reply({ error: "请求来源不合法" }, 403);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4_000_000)
    return reply({ error: "同步批次过大，请分批提交" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "请求格式错误" }, 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return reply({ error: "同步协议版本或记录格式不正确" }, 400);
  const keys = new Set<string>();
  for (const change of parsed.data.changes) {
    const key = `${change.table}:${change.recordId}`;
    if (keys.has(key))
      return reply({ error: "一个批次不能重复修改同一记录" }, 400);
    keys.add(key);
    if (change.payload !== null) {
      if (
        !PayloadSchemas[change.table].safeParse(change.payload).success ||
        payloadId(change.table, change.payload) !== change.recordId
      )
        return reply({ error: `${change.table} 记录格式不正确` }, 400);
      if (change.table === "todos") {
        const p = change.payload.coordinate as { x: number; y: number };
        if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)
          return reply({ error: "待办坐标超出 0–100" }, 400);
      }
    }
  }
  try {
    return reply(await cadenceStore().sync(parsed.data.changes));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/日程|执行记录|多个设备|复盘格|待办坐标|任务/.test(message))
      return reply({ error: message }, 409);
    return reply({ error: "同步暂未完成，请稍后重试；本地修改已保留" }, 503);
  }
};
