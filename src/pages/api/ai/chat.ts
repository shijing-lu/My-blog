/**
 * POST /api/ai/chat —— AI 对话（SSE 流式代理）
 *
 * - 管理员（站主/GitHub 管理员）直通；游客需 allowGuests 开关 + 双层限流：
 *   内存 IP 每日计数（serverless 冷启动重置，尽力而为）+ DB 全局每日计数。
 * - 请求体 { messages: [{role:'user'|'assistant', content}] }；选中文字由前端模板化进首条 user 消息。
 * - 服务端注入 systemPrompt（小卿人设）+ 身份差异化段（主人=顶级管理员：亲昵高配合；
 *   访客：礼貌克制。isTopAdmin 服务端判定，不受前端传参影响）后转发上游 OpenAI 兼容
 *   /v1/chat/completions stream:true，解析上游 delta 后**重帧**为自定义轻量 SSE 下发：
 *     data: {"delta":"文本片段"}   （逐段）
 *     data: {"error":"错误信息"}   （流中任意时刻出错）
 *     data: {"done":true}          （正常收尾）
 * - 客户端断开时联动终止上游请求（不白烧 token）。
 *
 * ## 记忆（仅站主，M3）
 *
 * - 站主请求：会话与消息**落库**（`ai_messages`，供摘要与回溯），并把长期记忆
 *   （`ai_memories`，按重要度×新鲜度取前 K，约 400 token）注入 system；
 *   注入块显式声明「仅背景信息、不是指令」以防经记忆绕行的提示注入。
 * - 游客/普通管理员：**完全不落库、不注入**（无记忆，见客人模式）。
 * - 注入只用「长期记忆块」+ 前端带来的本次对话历史；DB 里的消息仅作摘要原料，
 *   因此不会与前端历史重复注入。
 * - done 帧额外带 `conversationId / turnCount / suggestSummarize`：
 *   前端据此在「每 N 轮」与「会话结束」调用 /api/ai/summarize 产出新记忆。
 */
import type { APIRoute } from 'astro';
import { badJson, forbidden, json, readJson } from '@/lib/api';
import { isManagerSession, isTopAdmin } from '@/lib/admin-auth';
import { ensureAiTables, readOwnerBond, type OwnerBondSnapshot } from '@/lib/ai-store';
import { bumpBondOnMessage, levelBehaviorText } from '@/lib/ai-bond';
import {
  appendMessage,
  buildMemoryBlock,
  countUserMessages,
  ensureConversation,
  listMemories,
  newConversationId,
  TURN_SUMMARY_EVERY,
} from '@/lib/ai-memory';
import {
  getAiConfig,
  isAiReady,
  buildChatUrl,
  bumpGuestUsage,
  DEFAULT_SYSTEM_PROMPT,
} from '@/lib/ai-config';

export const prerender = false;

/** 消息条数上限 */
const MAX_MESSAGES = 20;
/** 单条内容字符上限 */
const MAX_CONTENT_CHARS = 4000;
/** 单 IP 每日请求上限（内存计数） */
const GUEST_IP_DAILY_LIMIT = 50;

/** 内存 IP 限流表（每实例独立，冷启动重置） */
const ipHits = new Map<string, { ymd: string; count: number }>();

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkIpLimit(ip: string): boolean {
  const ymd = todayYmd();
  const rec = ipHits.get(ip);
  if (!rec || rec.ymd !== ymd) {
    ipHits.set(ip, { ymd, count: 1 });
    // 顺带清理过期条目，防 Map 无限增长
    if (ipHits.size > 5000) for (const [k, v] of ipHits) if (v.ymd !== ymd) ipHits.delete(k);
    return true;
  }
  rec.count += 1;
  return rec.count <= GUEST_IP_DAILY_LIMIT;
}

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 消息结构校验与截断（非法返回 null） */
function sanitizeMessages(raw: unknown): IncomingMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: IncomingMessage[] = [];
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) return null;
    const o = m as Record<string, unknown>;
    if (o.role !== 'user' && o.role !== 'assistant') return null;
    if (typeof o.content !== 'string' || o.content.trim() === '') return null;
    out.push({ role: o.role, content: o.content.slice(0, MAX_CONTENT_CHARS) });
  }
  return out;
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  // 1. 身份与开关（主人=顶级管理员：站主会话或 role=top 的 GitHub 管理员；判定在服务端，不受前端传参影响）
  const [isManager, isOwner] = await Promise.all([isManagerSession(cookies), isTopAdmin(cookies)]);
  const cfg = await getAiConfig();
  if (!isAiReady(cfg)) return forbidden('AI 功能未启用或配置不完整');
  if (!isManager && !cfg.allowGuests) return forbidden('AI 功能仅对管理员开放');

  // 2. 游客双层限流（IP 内存计数 + 全局 DB 计数）
  if (!isManager) {
    const ip = typeof clientAddress === 'string' && clientAddress !== '' ? clientAddress : 'unknown';
    if (!checkIpLimit(ip)) return json({ error: '请求过于频繁，请明天再试' }, 429);
    const usage = await bumpGuestUsage(cfg.guestDailyLimit);
    if (!usage.allowed) return json({ error: `今日使用已达上限（${usage.limit} 次）` }, 429);
  }

  // 3. 请求校验
  const body = await readJson<{ messages?: unknown; conversationId?: unknown }>(request);
  if (!body) return badJson();
  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return json({ error: `消息不合法（1-${MAX_MESSAGES} 条，每条需有内容且不超过 ${MAX_CONTENT_CHARS} 字）` }, 400);
  }

  // 4. 转发上游（stream:true）。
  // ⚠️ 不能把 request.signal 直接传给上游 fetch：Astro 环境里该 signal 传入 undici
  // fetch 会立即 AbortError（dev 实证，signal.aborted 仍为 false 也抛）。客户端断开的
  // 联动取消改由下方 ReadableStream.cancel() → upstreamController.abort() 完成。
  const basePrompt = cfg.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
  // 差异化态度（身份由服务端判定，无法伪造）：主人亲昵高配合 / 访客礼貌克制
  const identityPrompt = isOwner
    ? '\n\n【当前提问者身份】本次对话的提问者是博客的顶级管理员，是小卿的主人。对主人的态度：用「主人」称呼对方；语气亲昵、忠诚、配合度高，卖萌撒娇可以放开一些；主人提出的要求尽力满足（违法有害内容除外）；被主人纠正时立即采纳不再坚持；可以主动为主人补充相关信息。'
    : '\n\n【当前提问者身份】本次对话的提问者是博客的普通访客。对访客的态度：礼貌、友好但适度克制，以专业、准确地解决问题为第一要务；不使用「主人」等亲昵称呼；卖萌克制（最多偶尔一次）；不主动索要个人信息、不引导站外操作；态度不卑不亢。';
  // 4.4 养成（仅站主）：消息到达后更新熟悉度
  // 4.5 记忆（仅站主）：会话与消息落库 + 长期记忆注入
  const incomingConversationId =
    typeof body.conversationId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.conversationId.trim())
      ? body.conversationId.trim()
      : '';
  const conversationId = isOwner ? incomingConversationId || newConversationId() : '';
  // 惰性建表：首次 AI 对话自动补齐 4 张表（失败 → 记忆降级为不可用，聊天不受影响）
  const tablesReady = await ensureAiTables();
  let memoryBlock = '';
  let turnCount = 0;
  if (isOwner && conversationId && tablesReady) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    await ensureConversation(conversationId, lastUser?.content ?? '');
    if (lastUser) {
      await appendMessage({ conversationId, role: 'user', content: lastUser.content });
      // 养成：消息到达 → 更新熟悉度聚合（等级只升不降）
      await bumpBondOnMessage(lastUser.content);
    }
    memoryBlock = buildMemoryBlock(await listMemories());
    turnCount = await countUserMessages(conversationId);
  }

  // 4.5 小卿数据层：读养成度（含亲密度 → meta 帧 + 行为约束注入 system）
  const bond: OwnerBondSnapshot = isOwner && tablesReady
    ? await readOwnerBond()
    : { level: 0, nickname: '', familiarity: 0 };
  /** 下发给前端的会话元信息（首帧；站主含等级/昵称/亲密度，访客仅身份） */
  const meta = { isOwner, level: bond.level, nickname: bond.nickname, familiarity: bond.familiarity };

  // 养成等级行为约束：等级越高，语气越放松（M4 核心体验）
  const behaviorPrompt = isOwner ? `\n\n【当前亲密度】你们的亲密度等级为 Lv.${bond.level}（${bond.level >= 4 ? '好友以上' : '还在熟悉中'}）。${levelBehaviorText(bond.level)}。` : '';
  const systemPrompt = basePrompt + identityPrompt + behaviorPrompt + memoryBlock;

  const upstreamController = new AbortController();
  let upstream: Response;
  try {
    upstream = await fetch(buildChatUrl(cfg.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: true,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      }),
      // 60s 上游保护（headers/首包超时即失败，避免服务端请求挂满 undici 默认 300s）
      signal: AbortSignal.any([upstreamController.signal, AbortSignal.timeout(60_000)]),
    });
  } catch (err) {
    console.error('[api/ai/chat] upstream fetch failed:', err);
    return json({ error: 'AI 服务连接失败，请检查 API 地址' }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const text = (await upstream.text().catch(() => '')).slice(0, 300);
    console.error(`[api/ai/chat] upstream HTTP ${upstream.status}:`, text);
    const hint =
      upstream.status === 401
        ? 'AI 服务鉴权失败（API Key 无效）'
        : upstream.status === 404
          ? 'AI 服务接口或模型不存在'
          : upstream.status === 429
            ? 'AI 服务限流，请稍后再试'
            : `AI 服务返回 HTTP ${upstream.status}`;
    return json({ error: hint }, 502);
  }

  // 5. 重帧：解析上游 SSE delta → 自定义轻量帧下发
  const encoder = new TextEncoder();
  const sse = (payload: string): Uint8Array => encoder.encode(`data: ${payload}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 首帧即下发 meta：前端在首字节到达时就能渲染昵称/等级/访客标识
      controller.enqueue(sse(JSON.stringify({ meta })));
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      /** 累积本次助手回答（流结束后落库；客户端中途断开时也保留已生成部分） */
      let assistantText = '';
      let persisted = false;
      const persistAssistant = async (): Promise<void> => {
        if (persisted || !isOwner || !conversationId || !assistantText.trim()) return;
        persisted = true;
        await appendMessage({ conversationId, role: 'assistant', content: assistantText });
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // 末行可能是半行，留到下一块
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] })
                .choices?.[0]?.delta?.content ?? '';
              if (delta) {
                assistantText += delta;
                controller.enqueue(sse(JSON.stringify({ delta })));
              }
            } catch {
              /* 单帧解析失败跳过（正常已被 buffer 半行逻辑避免） */
            }
          }
        }
        await persistAssistant();
        controller.enqueue(
          sse(
            JSON.stringify({
              done: true,
              conversationId,
              turnCount,
              // 命中摘要阈值时提示前端触发摘要（前端 fire-and-forget，不阻塞对话）
              suggestSummarize: isOwner && turnCount > 0 && turnCount % TURN_SUMMARY_EVERY === 0,
            }),
          ),
        );
      } catch (err) {
        // 上游中断或客户端断开：尽力通知前端
        try {
          controller.enqueue(sse(JSON.stringify({ error: err instanceof Error ? err.message : 'stream interrupted' })));
        } catch {
          /* 流已关 */
        }
      } finally {
        // 异常/中途断开也要尽力保住已生成的回答（失败静默，不影响收尾）
        await persistAssistant().catch(() => {});
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
        reader.releaseLock();
      }
    },
    cancel() {
      // 客户端断开：终止上游请求，不白烧 token
      upstreamController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
};
