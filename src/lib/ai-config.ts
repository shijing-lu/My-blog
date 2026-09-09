/**
 * AI 助手「小卿」配置（DB settings 表持久化，管理员在线配置，不落 .env）
 *
 * - 存储：settings 表的 `ai_config` 键（JSON），与 image_bed 同模式；
 * - apiKey 明文仅存 DB，读取接口只回传掩码（hasApiKey 布尔），明文不回前端；
 * - 保存时 apiKey 留空 → 保留原值（表单「留空=不修改」语义）；
 * - enabled=false 或必填项缺失时，/api/ai/chat 直接拒绝（isAiReady 判定）。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** settings 表行 */
type SettingsRow = typeof settings.$inferSelect;

/** 配置键 */
const KEY = 'ai_config';

/** AI 助手配置 */
export interface AiConfig {
  /** 总开关（关闭时 /api/ai/chat 直接拒绝） */
  enabled: boolean;
  /** API 根地址，如 https://api.deepseek.com（自动规范化拼接 /v1/chat/completions） */
  baseUrl: string;
  /** API Key（仅存 DB；序列化时掩码，不回传明文） */
  apiKey: string;
  /** 模型名称，如 deepseek-chat / gpt-4o-mini / qwen-plus */
  model: string;
  /** 采样温度 [0,2]，默认 0.7 */
  temperature: number;
  /** 单次回答最大 token，[64, 8192]，默认 1024 */
  maxTokens: number;
  /** 系统提示词（「小卿」人设），留空用内置默认 */
  systemPrompt: string;
  /** 游客（未登录访客）是否可用 */
  allowGuests: boolean;
  /** 游客每日全局请求上限（0 = 不限） */
  guestDailyLimit: number;
}

/** 未配置时的默认值 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: '',
  allowGuests: true,
  guestDailyLimit: 100,
};

/** 内置系统提示词（systemPrompt 留空时使用） */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是「小卿」，本个人博客的 AI 阅读助手。用户会在页面中选中一段文字向你提问。',
  '回答要求：使用简体中文；简洁准确，直接回答问题；适当使用短段落与列表；代码放在代码块中；不确定的内容如实说明，不要编造。',
].join('\n');

/** 前端可见的配置形态：apiKey 换成 hasApiKey 布尔 */
export type PublicAiConfig = Omit<AiConfig, 'apiKey'> & { hasApiKey: boolean };

/** 文本字段清洗：trim + 长度上限 */
function cleanText(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

/** 数字字段清洗：NaN/越界回落 fallback */
function cleanNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 规范化并校验配置（PATCH 语义：文本字段留空 = 保留原值，防止部分更新误清空） */
function normalizeConfig(input: Partial<AiConfig>, base: AiConfig): AiConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    baseUrl: cleanText(input.baseUrl, 300) || base.baseUrl,
    // apiKey：非空字符串才更新（空 = 保留原值）
    apiKey:
      typeof input.apiKey === 'string' && input.apiKey.trim() !== '' ? input.apiKey.trim().slice(0, 200) : base.apiKey,
    model: cleanText(input.model, 100) || base.model,
    temperature: cleanNumber(input.temperature, 0, 2, base.temperature),
    maxTokens: cleanNumber(input.maxTokens, 64, 8192, base.maxTokens),
    systemPrompt: cleanText(input.systemPrompt, 2000),
    allowGuests: typeof input.allowGuests === 'boolean' ? input.allowGuests : base.allowGuests,
    guestDailyLimit: cleanNumber(input.guestDailyLimit, 0, 100000, base.guestDailyLimit),
  };
}

/** 读取配置（无记录/解析失败回落默认） */
export async function getAiConfig(): Promise<AiConfig> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return normalizeConfig(parsed, { ...DEFAULT_AI_CONFIG });
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

/** 保存配置（upsert）。apiKey 留空 = 保留原值；返回保存后的完整配置 */
export async function saveAiConfig(input: Partial<AiConfig>): Promise<AiConfig> {
  const current = await getAiConfig();
  const normalized = normalizeConfig(input ?? {}, current);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(normalized), updatedAt: now },
      }),
  );
  return normalized;
}

/** 序列化给前端：apiKey 不回传明文，仅给 hasApiKey 布尔 */
export function serializeAiConfig(c: AiConfig): PublicAiConfig {
  const { apiKey, ...rest } = c;
  return { ...rest, hasApiKey: apiKey.trim() !== '' };
}

/** AI 是否就绪（开关开 + baseUrl/apiKey/model 齐全）。连通性交给「测试连接」验证 */
export function isAiReady(c: AiConfig): boolean {
  return c.enabled && c.baseUrl.trim() !== '' && c.apiKey.trim() !== '' && c.model.trim() !== '';
}

/** 游客用量计数（settings 表 `ai_usage` 键，全局每日一档） */
const USAGE_KEY = 'ai_usage';

export interface AiUsage {
  /** 统计日（UTC 日期 yyyy-mm-dd，跨日自动重置） */
  ymd: string;
  /** 当日游客请求数 */
  guestCount: number;
}

/**
 * 游客请求计数 +1 并判断是否超限。
 * - limit=0 视为不限；计数写失败不阻塞对话（尽力而为，serverless 多实例间非严格精确）。
 * - 按 UTC 日期统计（Vercel 函数时区为 UTC，与东八区「每日」边界相差 8 小时，可接受）。
 */
export async function bumpGuestUsage(limit: number): Promise<{ allowed: boolean; used: number; limit: number }> {
  const ymd = new Date().toISOString().slice(0, 10);
  let used = 0;
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, USAGE_KEY)).limit(1);
    const raw = rows[0]?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiUsage>;
      if (parsed.ymd === ymd && typeof parsed.guestCount === 'number') used = parsed.guestCount;
    }
  } catch {
    /* 读失败按 0 计 */
  }
  used += 1;
  const value = JSON.stringify({ ymd, guestCount: used } satisfies AiUsage);
  try {
    const now = new Date();
    await dbWrite((d) =>
      d
        .insert(settings)
        .values({ key: USAGE_KEY, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }),
    );
  } catch {
    /* 计数写失败不阻塞对话 */
  }
  if (limit <= 0) return { allowed: true, used, limit: 0 };
  return { allowed: used <= limit, used, limit };
}

/**
 * 规范化 baseUrl 为完整 chat completions 端点：
 * - 已填完整端点（…/chat/completions）→ 原样
 * - 填到 /v1 → 拼 /chat/completions
 * - 填根地址 → 拼 /v1/chat/completions
 */
export function buildChatUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

export type { SettingsRow };
