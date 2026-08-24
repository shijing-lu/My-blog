/**
 * 点赞身份工具（仅浏览器）
 *
 * - 匿名：浏览器指纹（localStorage 持久 UUID）；
 * - GitHub 登录：读取 Twikoo 登录态（localStorage['twikoo-access-token']），
 *   用 token 的稳定哈希作为身份标识（不存明文 token），与匿名分开计数。
 */
const FP_KEY = 'myblog_like_fp';
/** Twikoo 登录 token 的 localStorage key */
const TWIKOO_TOKEN_KEY = 'twikoo-access-token';

export function getLikeFingerprint(): string {
  try {
    let fp = localStorage.getItem(FP_KEY);
    if (!fp) {
      fp = crypto.randomUUID();
      localStorage.setItem(FP_KEY, fp);
    }
    return fp;
  } catch {
    // localStorage 不可用（隐私模式等）：临时随机指纹
    return `tmp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/** cyrb53 快速字符串哈希（稳定、无冲突担忧，用于 token 脱敏标识） */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** 当前点赞身份：GitHub 登录（Twikoo token 存在）→ github；否则匿名 */
export function getLikeIdentity(): { userType: 'anonymous' | 'github'; userIdent: string } {
  try {
    const token = localStorage.getItem(TWIKOO_TOKEN_KEY);
    if (token) {
      return { userType: 'github', userIdent: cyrb53(token) };
    }
  } catch {
    /* localStorage 不可用 → 匿名 */
  }
  return { userType: 'anonymous', userIdent: getLikeFingerprint() };
}
