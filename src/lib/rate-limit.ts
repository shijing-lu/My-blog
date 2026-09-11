/**
 * 极简内存限流（固定窗口计数）
 *
 * 只用于**单个实例内**的粗粒度防护（P3-9：上传接口原先毫无速率限制，
 * 一次误触/脚本循环就能把 R2 与 GitHub 图床写满）。
 *
 * 适用边界（务必知晓）：
 * - Serverless 多实例部署时，各实例各持一份计数 → 实际放行量 = 限额 × 实例数。
 *   这是**有意**接受的取舍：不引入 Redis/Upstash 等外部依赖，先把"完全裸奔"变成"有闸"。
 * - 进程重启 / 冷启动即清零，不做持久化。
 *
 * 需要严格全局限流时（例如防刷评论），应换成共享存储实现，接口保持一致即可。
 */

/** 单个 key 的窗口状态 */
interface Bucket {
  /** 窗口内已用次数 */
  count: number;
  /** 窗口到期时间戳（ms, Date.now() 基准） */
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();

/** Map 容量上限：防止大量一次性 key（扫描不同 IP）把内存撑爆 */
const MAX_KEYS = 5000;

/** 上次清理时间，避免每次请求都全表扫描 */
let lastSweep = 0;

/** 清理已过期的桶；距上次清理超过 SWEEP_INTERVAL_MS 才真正执行 */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  BUCKETS.forEach((b, key) => {
    if (b.resetAt <= now) BUCKETS.delete(key);
  });
  // 仍然超限（极端：全部未过期）→ 按插入顺序丢最旧的一批，保证有界
  while (BUCKETS.size > MAX_KEYS) {
    const oldest = BUCKETS.keys().next().value;
    if (oldest === undefined) break;
    BUCKETS.delete(oldest);
  }
}

/** 清理间隔（ms）：过期桶最长可多存活这么久，换来的是不必每次请求全表扫描 */
const SWEEP_INTERVAL_MS = 60_000;

export interface RateLimitResult {
  /** 是否放行 */
  ok: boolean;
  /** 还剩多少次可用（ok=false 时为 0） */
  remaining: number;
  /** 距窗口重置还有多少秒（ok=true 时也返回，便于前端提示） */
  retryAfterSec: number;
}

/**
 * 记一次请求并返回是否放行
 *
 * @param key 限流维度（如 `upload:1.2.3.4`）
 * @param limit 窗口内允许的最大次数
 * @param windowMs 窗口长度（ms）
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: windowMs / 1000 };
  }
  bucket.count += 1;
  const retryAfterSec = Math.max(1, (bucket.resetAt - now) / 1000);
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec };
  }
  return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterSec };
}

/**
 * 取请求来源标识（用于限流 key）
 *
 * 优先标准 `x-forwarded-for` 首段（Vercel / 多数网关会注入），
 * 回退 `cf-connecting-ip`，都没有时用固定串（此时同一实例共用一个限额）。
 */
export function clientKey(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  return 'unknown';
}
