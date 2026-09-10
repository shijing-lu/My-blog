/**
 * 文章解锁 —— 浏览器侧解密（Web Crypto API）
 *
 * ## 职责
 *
 * 1. 用访客输入的密码 + 服务端下发的 salt，经 PBKDF2-SHA256 派生 AES-256 密钥；
 * 2. 用该密钥以 AES-GCM 解密正文密文（GCM 自带认证 → 密码错误会直接抛错，
 *    无需额外的校验哈希）；
 * 3. 解出的明文 MDX POST 给 `/api/unlock-render` 渲染成 HTML 注入页面。
 *
 * ## 安全要点
 *
 * - 密码**只在本模块内参与密钥派生**，不写入 localStorage / cookie / URL；
 * - 解锁成功后把明文缓存在内存（模块级 Map，key = 文章 slug），刷新页面即丢失；
 *   如需「本次会话内免重输」，由调用方决定是否写 sessionStorage（默认不写）；
 * - 派生参数（迭代次数等）由页面内联下发，必须与服务端 `article-crypto.ts` 一致。
 *
 * ## 与旧浏览器的兼容
 *
 * `crypto.subtle` 仅在安全上下文（HTTPS / localhost）可用。HTTP 环境下降级为
 * 「当前环境不支持解密」，而不是静默失败——避免用户以为是密码错误。
 */

/** 解密所需的参数（由页面内联注入） */
export interface UnlockParams {
  /** PBKDF2 迭代次数 */
  iterations: number;
  /** base64 盐 */
  salt: string;
  /** base64 初始化向量 */
  iv: string;
  /** base64 密文（含 16 字节 GCM 认证标签） */
  ct: string;
  /** 渲染接口地址（默认 /api/unlock-render） */
  renderUrl?: string;
  /** 是否 photo 布局（影响图片尺寸注入策略） */
  photo?: boolean;
}

/** 解锁失败的原因分类（供 UI 给出精确提示） */
export type UnlockFailure = 'unsupported' | 'wrong-password' | 'network' | 'render' | 'empty';

/** 解锁结果 */
export type UnlockResult =
  | { ok: true; html: string }
  | { ok: false; reason: UnlockFailure; message: string };

/** base64 → Uint8Array（浏览器 atob） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 判断当前环境是否支持 Web Crypto 解密 */
export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * 用密码派生 AES-256-GCM 密钥。
 *
 * @param password 用户输入的密码
 * @param salt 盐
 * @param iterations PBKDF2 迭代次数
 * @returns CryptoKey（仅可用于 decrypt，不可导出）
 */
async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/**
 * 尝试用密码解出正文，并请求服务端渲染。
 *
 * @param password 用户输入的密码
 * @param params 解密参数
 * @returns 渲染结果或失败原因
 */
export async function unlockArticle(password: string, params: UnlockParams): Promise<UnlockResult> {
  if (!password) return { ok: false, reason: 'empty', message: '请输入访问密码' };
  if (!isWebCryptoAvailable()) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '当前环境不支持浏览器解密（需 HTTPS 访问）',
    };
  }

  let plaintext: string;
  try {
    const key = await deriveKey(password, b64ToBytes(params.salt), params.iterations);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(params.iv) as unknown as BufferSource },
      key,
      b64ToBytes(params.ct) as unknown as BufferSource,
    );
    plaintext = new TextDecoder().decode(buf);
  } catch {
    // AES-GCM 认证失败 = 密码错误或密文被篡改，两者对本场景同义
    return { ok: false, reason: 'wrong-password', message: '密码错误，请重试' };
  }

  try {
    const res = await fetch(params.renderUrl ?? '/api/unlock-render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: plaintext, photo: params.photo === true }),
    });
    const data = (await res.json().catch(() => ({}))) as { html?: string; error?: string };
    if (!res.ok || typeof data.html !== 'string') {
      return { ok: false, reason: 'render', message: data.error ?? '正文渲染失败' };
    }
    return { ok: true, html: data.html };
  } catch {
    return { ok: false, reason: 'network', message: '网络异常，请稍后重试' };
  }
}
