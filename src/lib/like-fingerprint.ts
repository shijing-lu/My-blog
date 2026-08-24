/**
 * 点赞匿名指纹（仅浏览器）
 *
 * 同一浏览器 = 同一用户（localStorage 持久 UUID）；
 * 清缓存/隐私模式下指纹失效（个人博客可接受，见设计确认）。
 */
const FP_KEY = 'myblog_like_fp';

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
