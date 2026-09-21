/**
 * POST /api/ai/summarize —— 会话摘要（产出长期记忆；仅站主）
 *
 * 触发时机（由前端在合适时机调用，见 AiChatFloat）：
 * ① 会话内每累计 TURN_SUMMARY_EVERY 条用户消息（done 帧里 suggestSummarize=true 提示）；
 * ② 面板关闭时（消息数 ≥ 4）做一次收尾摘要。
 *
 * 设计要点：
 * - **幂等**：重复调用不会产生重复记忆——解析产物先与既有记忆做归一化去重（mergeDrafts），
 *   命中的只提升重要度，未命中的才新增；
 * - **脱敏**：写入前逐条脱敏（`cleanDraft` 内做），凭据/手机号/银行卡等原文不落库；
 * - **不阻塞聊天**：本端点是独立请求，聊天流早已结束；失败只返回 { ok:false }，前端静默处理。
 */
import type { APIRoute } from 'astro';
import { isTopAdmin } from '@/lib/admin-auth';
import { badJson, forbidden, json, readJson } from '@/lib/api';
import { buildChatUrl, getAiConfig, isAiReady } from '@/lib/ai-config';
import { ensureAiTables } from '@/lib/ai-store';
import {
  insertMemories,
  listConversationMessages,
  listMemories,
  mergeDrafts,
  parseSummaryJson,
  promoteMemories,
} from '@/lib/ai-memory';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 摘要提示词：只输出「值得长期记住」的信息，严格 JSON 数组 */
const SUMMARY_PROMPT = [
  '你是记忆整理助手。阅读下面的对话记录，提取**值得长期记住**的信息。',
  '',
  '只提取这三类：',
  '- fact：关于对方的事实（身份、职业、所在地、正在做的事、长期目标、重要人物/物品的名字）',
  '- preference：对方的偏好与厌恶（喜欢/讨厌什么、习惯、风格偏好）',
  '- event：对将来仍有意义的事件（截止日期、计划、约定、里程碑）',
  '',
  '严格要求：',
  '1. 只输出 JSON 数组，不要任何解释文字、不要代码围栏之外的内容；',
  '2. 每条 content 不超过 40 个汉字，必须是**陈述句**，主语用「主人」或对方的名字；',
  '3. importance 取 1~5（5 最重要）；只记 3~5 条，宁缺毋滥；',
  '4. **不要记**寒暄、一次性提问、与本对话无关的通用知识；',
  '5. 涉及密码、密钥、token、身份证、银行卡、手机号的内容一律不要输出。',
  '',
  '输出格式示例：',
  '[{"kind":"fact","content":"主人在准备 408 考研，目标是计算机组成原理","importance":5}]',
].join('\n');

/** 参与摘要的最大消息条数（够用即可，控制成本） */
const MAX_TRANSCRIPT_MESSAGES = 60;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies))) return forbidden('记忆功能仅对站主开放');

  const cfg = await getAiConfig();
  if (!isAiReady(cfg)) return forbidden('AI 功能未启用或配置不完整');

  const body = await readJson<{ conversationId?: string }>(request);
  if (!body || typeof body.conversationId !== 'string' || body.conversationId.trim() === '') {
    return badJson();
  }
  const conversationId = body.conversationId.trim();

  // 表可能尚未建好（首次对话刚建）：失败则本次不摘要，不抛错
  if (!(await ensureAiTables())) return json({ ok: false, error: '数据层不可用' }, 503);

  const messages = await listConversationMessages(conversationId);
  if (messages.length < 2) return json({ ok: true, added: 0, promoted: 0, note: '会话太短，无需摘要' });

  const transcript = messages
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((m) => `${m.role === 'user' ? '用户' : '小卿'}：${m.content.slice(0, 1500)}`)
    .join('\n');

  let raw = '';
  try {
    const upstream = await fetch(buildChatUrl(cfg.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: transcript },
        ],
        stream: false, // 摘要要整段 JSON，不需要流式
        temperature: 0.2,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!upstream.ok) {
      console.error(`[api/ai/summarize] upstream HTTP ${upstream.status}`);
      return json({ ok: false, error: `摘要服务返回 HTTP ${upstream.status}` }, 502);
    }
    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    raw = data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    console.error('[api/ai/summarize] upstream 调用失败:', (err as Error).message);
    return json({ ok: false, error: '摘要服务连接失败' }, 502);
  }

  const drafts = parseSummaryJson(raw);
  if (drafts.length === 0) return json({ ok: true, added: 0, promoted: 0, note: '本次未提取到新信息' });

  const existing = await listMemories();
  const { fresh, dup } = mergeDrafts(existing, drafts);
  const added = await insertMemories(fresh, conversationId);
  await promoteMemories(dup);

  return json({ ok: true, added, promoted: dup.length, total: existing.length + added });
};
