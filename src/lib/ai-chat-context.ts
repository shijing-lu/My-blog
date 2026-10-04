/** 前后端共享的对话预算：保留最近上下文，避免长会话超过接口限制或持续放大输入费用。 */
export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_CHARS = 4000;
export const MAX_CHAT_CONTEXT_CHARS = 12_000;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function boundChatContext(messages: readonly ChatMessage[]): ChatMessage[] {
  const recent: ChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && recent.length < MAX_CHAT_MESSAGES; i -= 1) {
    const message = messages[i]!;
    const content = message.content.slice(0, MAX_CHAT_MESSAGE_CHARS);
    if (!content.trim()) continue;
    if (chars + content.length > MAX_CHAT_CONTEXT_CHARS) break;
    recent.push({ role: message.role, content });
    chars += content.length;
  }
  recent.reverse();
  // 被裁掉用户提问的孤立回答没有语境，也不兼容部分上游模型。
  while (recent[0]?.role === 'assistant') recent.shift();
  return recent;
}

/** 校验完整输入后才裁剪，避免非法历史被静默接受。 */
export function sanitizeChatMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHAT_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const message = item as Record<string, unknown>;
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    if (typeof message.content !== 'string' || !message.content.trim()) return null;
    messages.push({ role: message.role, content: message.content });
  }
  if (messages.at(-1)?.role !== 'user') return null;
  return boundChatContext(messages);
}
/** 摘要保留最近的消息，在原文预算内按时间顺序输出。 */
export function buildSummaryTranscript(messages: readonly ChatMessage[]): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const line = (message.role === 'user' ? '用户：' : '小卿：') + message.content.slice(0, 1500);
    if (used + line.length + 1 > MAX_CHAT_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.reverse().join('\n');
}
