/**
 * 文章加密 —— 服务端侧实现（Node crypto）
 *
 * ## 设计取舍：为什么是「服务端加密 + 客户端解密」
 *
 * 三种可选架构：
 * 1. **纯服务端解密**：密码明文提交给服务端校验。实现最简单，但密码经过服务端，
 *    且服务端持有解密能力（数据库泄露 + 密钥管理不当即全面失守）。
 * 2. **纯客户端解密 + 客户端渲染**：零知识，安全性最高；但要在前端重建整套
 *    MDX 渲染管线（公式 / 荧光高亮 / Callout / 图片尺寸注入…），成本高且会长期
 *    分裂两套渲染逻辑。
 * 3. **服务端加密 + 客户端解密 + 服务端渲染**（本实现）：
 *    - 密码**只在浏览器内**参与密钥派生，服务端从未见过密码明文；
 *    - 服务端只保存 `salt + iv + ciphertext`，**没有密码就无法解密**；
 *    - 解锁后客户端把明文 MDX POST 给 `/api/render-mdx` 复用现成的 `renderMdx`
 *      全链路，视觉效果与普通文章完全一致。
 *
 * 结论：3 在「安全强度」与「复用现有渲染能力」之间取得平衡，且不牺牲任何富文本特性。
 *
 * ## 密码学参数（必须与客户端 Web Crypto 完全一致）
 *
 * - KDF：PBKDF2-SHA256，250000 次迭代（OWASP 建议下限 600k 是针对弱口令场景；
 *   本场景密码由站主自设且长度校验 8+，250k 兼顾老设备解锁耗时，实测 < 200ms）
 * - 对称加密：AES-256-GCM（AEAD，天然抗篡改 + 认证标签）
 * - `salt`：16 字节随机（每次加密重新生成）
 * - `iv`：12 字节随机（GCM 推荐长度；同一密钥下绝不复用）
 *
 * ⚠️ 明文密码**绝不落库、绝不写日志**，函数退出即失去引用。
 */
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import type { EncryptMeta } from '../../db/types';

/** 当前加密格式版本 */
const VERSION = 1;
/** PBKDF2 迭代次数（与 src/scripts/article-lock.client.ts 保持一致） */
const ITERATIONS = 250_000;
/** 盐长度（字节） */
const SALT_LEN = 16;
/** GCM 初始化向量长度（字节） */
const IV_LEN = 12;
/** AES-256 密钥长度（字节） */
const KEY_LEN = 32;
/** GCM 认证标签长度（字节） */
const TAG_LEN = 16;

/** 密码最短长度（纯数字等弱口令不做额外限制，由站主自行把控强度） */
export const MIN_PASSWORD_LENGTH = 8;
/** 密码最长长度（PBKDF2 输入无上限，但限制可防止超长输入拖慢派生） */
export const MAX_PASSWORD_LENGTH = 256;

/** 加密参数错误的统一异常类型（供 API 层转 400） */
export class ArticleCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticleCryptoError';
  }
}

/**
 * 校验密码强度。
 *
 * @param password 待校验密码
 * @throws {ArticleCryptoError} 长度不合法时抛出（消息可直接展示给用户）
 */
export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new ArticleCryptoError('请设置访问密码');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ArticleCryptoError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ArticleCryptoError(`密码最长 ${MAX_PASSWORD_LENGTH} 位`);
  }
}

/**
 * 用密码派生 AES-256 密钥（PBKDF2-SHA256）。
 *
 * @param password 密码明文
 * @param salt 随机盐
 * @returns 32 字节密钥
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');
}

/**
 * 加密正文，产出可长期存储的元数据。
 *
 * @param plaintext MDX 明文源码
 * @param password 用户设置的访问密码
 * @returns 加密元数据（可直接 JSON.stringify 落库）
 */
export function encryptContent(plaintext: string, password: string): EncryptMeta {
  assertPasswordStrength(password);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 密文与认证标签拼接存储（解密时按 TAG_LEN 切分），减少一个字段
  const payload = Buffer.concat([ct, tag]);

  return {
    v: VERSION,
    algo: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: payload.toString('base64'),
  };
}

/**
 * 解析落库的加密元数据 JSON。
 *
 * @param raw `encrypt_meta` 列原文
 * @returns 解析结果；非法/空则返回 null（视作未加密）
 */
export function parseEncryptMeta(raw: string | null | undefined): EncryptMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EncryptMeta>;
    if (
      parsed?.v !== VERSION ||
      parsed.algo !== 'AES-GCM' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.ct !== 'string'
    ) {
      return null;
    }
    return {
      v: VERSION,
      algo: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: typeof parsed.iterations === 'number' ? parsed.iterations : ITERATIONS,
      salt: parsed.salt,
      iv: parsed.iv,
      ct: parsed.ct,
    };
  } catch {
    return null;
  }
}

/**
 * 解密正文（**管理端二次编辑**场景使用；访客侧解密在浏览器完成）。
 *
 * @param meta 加密元数据
 * @param password 密码明文
 * @returns 解密后的 MDX 源码；密码错误或数据被篡改返回 null
 */
export function decryptContent(meta: EncryptMeta, password: string): string | null {
  try {
    const salt = Buffer.from(meta.salt, 'base64');
    const iv = Buffer.from(meta.iv, 'base64');
    const payload = Buffer.from(meta.ct, 'base64');
    // 最小合法长度 = 空明文对应的 16 字节 GCM 认证标签。
    // ⚠️ 必须用 `<`：空明文加密后 payload 恰好等于 TAG_LEN，用 `<=` 会把
    // 「加密后的空正文」误判为非法数据（实测测试用例暴露）。
    if (payload.length < TAG_LEN) return null;

    const ct = payload.subarray(0, payload.length - TAG_LEN);
    const tag = payload.subarray(payload.length - TAG_LEN);

    const key = deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    // GCM 认证失败（密码错/密文被改）会在此抛错，由 catch 归一为 null
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 加密参数的公开描述（供前端拿到与后端一致的 KDF 参数）。
 * 注意：**不含任何密钥材料**，可安全内联进 HTML。
 */
export const CRYPTO_PARAMS = {
  version: VERSION,
  algo: 'AES-GCM' as const,
  kdf: 'PBKDF2-SHA256' as const,
  iterations: ITERATIONS,
  saltLength: SALT_LEN,
  ivLength: IV_LEN,
} as const;
