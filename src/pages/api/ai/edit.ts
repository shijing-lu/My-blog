import type { APIRoute } from "astro";
import { isTopAdmin } from "../../../lib/admin-auth";
import { json, readJson } from "../../../lib/api";
import {
  runDocumentAgent,
  commitEdit,
  undoEdit,
  type EditInput,
} from "../../../lib/ai-document-agent";
import { getPrimaryDb } from "../../../../db";
import { aiEditRuns } from "../../../../db/schema.sqlite";
import { and, eq, desc } from "drizzle-orm";
import { ensureAiTables } from "../../../lib/ai-store";
const headers = { "cache-control": "private, no-store" };
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return json({ error: "仅站主可读取修改历史" }, { status: 403, headers });
  if (!(await ensureAiTables()))
    return json({ error: "修改数据层不可用" }, { status: 503, headers });
  const domain = url.searchParams.get("domain"),
    targetId = url.searchParams.get("targetId"),
    runId = url.searchParams.get("runId");
  if (!domain || !["article", "doc"].includes(domain) || !targetId)
    return json({ error: "参数不合法" }, { status: 400, headers });
  const rows = await getPrimaryDb()
    .select()
    .from(aiEditRuns)
    .where(
      and(
        eq(aiEditRuns.domain, domain),
        eq(aiEditRuns.targetId, targetId),
        ...(runId ? [eq(aiEditRuns.id, runId)] : []),
      ),
    )
    .orderBy(desc(aiEditRuns.createdAt))
    .limit(runId ? 1 : 20);
  return json(
    {
      runs: rows.map((r) =>
        runId
          ? {
              id: r.id,
              status: r.status,
              createdAt: r.createdAt,
              before: r.before,
              after: r.after,
            }
          : { id: r.id, status: r.status, createdAt: r.createdAt },
      ),
    },
    { headers },
  );
};
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return json(
      { error: "仅站主可使用 AI 文章编辑" },
      { status: 403, headers },
    );
  const body = await readJson<EditInput>(request);
  if (
    !body ||
    !["article", "doc"].includes(body.domain) ||
    typeof body.targetId !== "string" ||
    typeof body.source !== "string" ||
    body.source.length > 500000 ||
    typeof body.instruction !== "string" ||
    !body.instruction.trim() ||
    body.instruction.length > 12000 ||
    !["selection", "document"].includes(body.scope) ||
    (body.scope === "selection" &&
      (typeof body.selection !== "string" ||
        !body.selection.trim() ||
        body.selection.length > 500000)) ||
    (body.history !== undefined &&
      (!Array.isArray(body.history) ||
        body.history.length > 12 ||
        body.history.some(
          (m) =>
            !m ||
            !["user", "assistant"].includes(m.role) ||
            typeof m.content !== "string" ||
            m.content.length > 12000,
        )))
  ) {
    return json({ error: "任务参数不合法" }, { status: 400, headers });
  }
  const abort = new AbortController(),
    encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (value: unknown) => {
        if (!abort.signal.aborted)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
          );
      };
      try {
        const output = await runDocumentAgent(
          body,
          AbortSignal.any([
            request.signal,
            abort.signal,
            AbortSignal.timeout(240000),
          ]),
          emit,
        );
        emit({ ready: output, done: true });
      } catch (e) {
        emit({ error: e instanceof Error ? e.message : "AI 编辑失败" });
      } finally {
        try {
          controller.close();
        } catch {
          /* disconnected */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      ...headers,
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
};
export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return json({ error: "仅站主可应用 AI 修改" }, { status: 403, headers });
  const body = await readJson<{ runId: string; content?: string }>(request);
  if (
    !body ||
    typeof body.runId !== "string" ||
    (body.content !== undefined &&
      (typeof body.content !== "string" || body.content.length > 500000))
  )
    return json({ error: "参数不合法" }, { status: 400, headers });
  try {
    return json(await commitEdit(body.runId, body.content), { headers });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 409, headers },
    );
  }
};
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return json({ error: "仅站主可撤销 AI 修改" }, { status: 403, headers });
  const body = await readJson<{ runId: string }>(request);
  if (!body || typeof body.runId !== "string")
    return json({ error: "参数不合法" }, { status: 400, headers });
  try {
    return json(await undoEdit(body.runId), { headers });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "恢复失败" },
      { status: 409, headers },
    );
  }
};
