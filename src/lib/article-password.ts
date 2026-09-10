/**
 * 文章访问密码 —— 服务端拦截模式
 *
 * ## 架构（2026-09-10 由「全文加密」改造而来）
 *
 * 原方案是「密文存库 + 浏览器解密 + 服务端渲染」，安全性最高但代价明显：
 * 密码遗忘即**永久丢失正文**（无明文副本可恢复）。站主实际使用场景是
 * 「不想让路人随手看到」，故改为**服务端密码拦截**：
 *
 * 1. 正文以**明文**存 `content` 列（不加密，备份/迁移/找回都正常）；
 * 2. 密码只存**哈希**（PBKDF2-SHA256 + 随机盐），用于校验，不可逆推；
 * 3. 访客访问详情页时，服务端检查「解锁 Cookie」：
 *    - 无有效 Cookie → **不渲染正文**，只渲染密码门禁表单；
 *    - 校验通过 → 签发签名 Cookie → 重新加载后服务端才渲染正文。
 *
 * ## 安全性边界（务必知悉）
 *
 * - ✅ 未解锁时正文**从不出现在 HTML / 网络响应**中（服务端不渲染），
 *   F12、禁用 JS、查看源码都拿不到。
 * - ⚠️ 但正文在**数据库里是明文**：拿到库权限的人可直接读到。
 *   这是「简单拦截」相对「全文加密」的固有权衡——换来的是密码可重设、
 *   内容不会因遗忘密码而永久丢失。
 * - Cookie 用 AUTH_SECRET 做 HMAC 签名，载荷含文章 id 与过期时间，
 *   不可伪造、不可跨文章复用。
 */
import { randomBytes, pbkdf2Sync, createHash, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

/** 密码哈希格式版本 */
const HASH_VERSION = 1;
/** PBKDF2 迭代次数（校验成本，与加密时代保持一致量级） */
const ITERATIONS = 250_000;
/** 盐长度（字节） */
const SALT_LEN = 16;
/** 派生密钥长度（字节） */
const KEY_LEN = 32;

/** 密码最长长度（防超长输入拖慢派生） */
export const MAX_PASSWORD_LENGTH = 256;

/** 解锁 Cookie 名前缀（按文章 id 区分，避免跨文章复用） */
const COOKIE_PREFIX = 'article_unlock_';

/** 密码相关错误的统一异常类型（供 API 层转 400） */
export class ArticlePasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticlePasswordError';
  }
}

/**
 * 校验密码是否满足最低要求。
 *
 * 用户明确要求**不做长度下限限制**：加密文章是站主自用的私密内容，
 * 强度由站主自行决定（1 位数字也允许）。仅拦空密码与超长输入。
 */
export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new ArticlePasswordError('请设置访问密码');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ArticlePasswordError(`密码最长 ${MAX_PASSWORD_LENGTH} 位`);
  }
}

/** 用密码派生校验密钥（PBKDF2-SHA256） */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');
}

/** 落库的密码哈希结构（JSON 存 `encrypt_meta` 列，复用原字段避免再加列） */
export interface PasswordHashMeta {
  v: number;
  algo: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  hash: string;
}

/**
 * 把明文密码转成可落库的哈希。
 *
 * @param password 站主设置的访问密码
 * @returns 哈希元数据（可直接 JSON.stringify 存库）
 */
export function hashPassword(password: string): PasswordHashMeta {
  assertPasswordStrength(password);
  const salt = randomBytes(SALT_LEN);
  const hash = deriveKey(password, salt);
  return {
    v: HASH_VERSION,
    algo: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

/**
 * 解析落库的密码哈希。
 *
 * 兼容处理：旧的「全文加密」格式（含 `ct` 字段）会被识别为**无法校验**，
 * 返回 null —— 调用方应提示站主重新设置该文章密码（老格式的密码本身
 * 也没法在服务端校验，因为当时密码从未上传）。
 *
 * @param raw `encrypt_meta` 列原文
 * @returns 解析结果；非法/空/旧加密格式则返回 null
 */
export function parsePasswordHash(raw: string | null | undefined): PasswordHashMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PasswordHashMeta>;
    if (
      parsed?.v !== HASH_VERSION ||
      parsed.algo !== 'PBKDF2-SHA256' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.hash !== 'string'
    ) {
      return null;
    }
    return {
      v: HASH_VERSION,
      algo: 'PBKDF2-SHA256',
      iterations: typeof parsed.iterations === 'number' ? parsed.iterations : ITERATIONS,
      salt: parsed.salt,
      hash: parsed.hash,
    };
  } catch {
    return null;
  }
}

/**
 * 校验密码是否与落库哈希匹配（timing-safe）。
 *
 * @param password 访客输入的密码
 * @param meta 落库的哈希元数据
 * @returns 是否匹配
 */
export function verifyPassword(password: string, meta: PasswordHashMeta): boolean {
  if (typeof password !== 'string' || password.length === 0) return false;
  try {
    const salt = Buffer.from(meta.salt, 'base64');
    const expected = Buffer.from(meta.hash, 'base64');
    const actual = pbkdf2Sync(password, salt, meta.iterations, expected.length, 'sha256');
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------------- 解锁 Cookie（签名 + 按文章隔离） ---------------- */

/** 解锁 Cookie 名（按文章 id 生成，防止跨文章复用） */
export function unlockCookieName(articleId: string): string {
  // 文章 id 可能是 uuid 或 slug 形态，做一层短哈希保证 Cookie 名合法且等长
  const digest = createHash('sha256').update(articleId).digest('hex').slice(0, 16);
  return `${COOKIE_PREFIX}${digest}`;
}

/**
 * 判断当前请求是否已解锁某篇文章。
 *
 * Cookie 载荷形如 `{  aid: <文章 id>, exp: <时间戳> }`，由 auth.ts 的
 * `signPayload` 做 HMAC 签名。双重校验：签名有效 **且** 载荷中的 aid
 * 等于当前文章 id —— 防止把 A 文章的解锁令牌拿去解锁 B 文章。
 *
 * @param cookies 请求 Cookie
 * @param articleId 文章 id
 * @param verify 签名校验函数（auth.ts 的 verifySignedPayload）
 * @param decode 载荷解码函数（本模块的 decodeTokenPayload）
 */
export function isArticleUnlocked(
  cookies: AstroCookies,
  articleId: string,
  verify: (token: string | null | undefined) => boolean,
  decode: (token: string | null | undefined) => Record<string, unknown> | null,
): boolean {
  const token = cookies.get(unlockCookieName(articleId))?.value ?? null;
  if (!verify(token)) return false;
  const payload = decode(token);
  return payload?.aid === articleId;
}

/** 解码签名令牌的载荷（不校验签名，须配合 verifySignedPayload 使用） */
export function decodeTokenPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const [payload] = token.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 门禁判定结果 */
export interface GateDecision {
  /** 是否需要门禁（正文不下发）。⚠️ 只由 `encrypted` 决定，不以哈希能否解析为准 */
  gated: boolean;
  /** 哈希是否可校验。false = 旧格式遗留，任何密码都无法通过，须站主重设 */
  metaUsable: boolean;
  /** 当前请求是否已解锁（可渲染正文） */
  unlocked: boolean;
  /** 是否拦截正文下发 */
  locked: boolean;
}

/**
 * 门禁判定（页面与测试共用的单一事实来源）。
 *
 * ⚠️ 不变式：`gated` 必须**只**取 `encrypted`。
 * 曾经的写法是 `gated = encrypted && parsePasswordHash(meta) != null`，
 * 导致存量 AES-GCM 格式的文章（哈希解析为 null）退化成
 * 「无门禁 + 正文不下发」的空白页 —— 加密文章直接裸奔成空白，
 * 既看不到内容也看不到门禁。加密标记一旦为真，门禁就必须在。
 *
 * @param encrypted 文章是否标记为加密
 * @param passwordMeta 解析后的密码哈希（null = 无法校验）
 * @param checkUnlocked 已解锁判定回调（仅在 gated 且 metaUsable 时调用）
 */
export function decideArticleGate(
  encrypted: boolean,
  passwordMeta: PasswordHashMeta | null,
  checkUnlocked: () => boolean,
): GateDecision {
  const gated = Boolean(encrypted);
  const metaUsable = Boolean(passwordMeta);
  const unlocked = gated && metaUsable ? checkUnlocked() : false;
  return { gated, metaUsable, unlocked, locked: gated && !unlocked };
}

