/**
 * 点赞身份工具（仅浏览器）
 *
 * 匿名指纹：localStorage 持久 UUID（隐私模式等 localStorage 不可用时降级为临时随机指纹）。
 * 评论/点赞统一用该指纹区分身份；GitHub 登录身份由服务端会话判定，与前端指纹无关。
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
