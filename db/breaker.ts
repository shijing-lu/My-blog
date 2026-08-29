/**
 * 电路断路器（circuit breaker）+ thenable 故障包裹：多端点故障转移的核心纯逻辑
 *
 * 设计：
 * - `createCircuitBreaker`：按端点优先级返回第一个「冷却已过期」的下标；某端点失败时
 *   `markDown` 将其冷却一段时间；冷却过期自动重新启用（自愈回切主库）；全部冷却时
 *   复位并回退最高优先级，避免全线不可用。
 * - `guardThenable`：给 postgres.js 的 pending query（thenable）包一层 Proxy，拦截
 *   `then/catch/finally`，reject 时回调 `onReject`；并递归包裹 `.values()` 等链式方法
 *   返回的新 thenable，保证整条链上的失败都能被捕获。
 *
 * 本模块为纯逻辑、无副作用、不依赖 postgres/drizzle，便于单元测试。
 */

/** 断路器对外接口 */
export interface CircuitBreaker {
  /** 返回当前应使用的端点下标 */
  pick(): number;
  /** 标记端点 i 下线 cooldown 毫秒（单端点时为空操作） */
  markDown(i: number): void;
  /** 端点总数 */
  readonly size: number;
  /** 仅供测试：读取某端点恢复时间戳（0 = 健康） */
  __downUntil(i: number): number;
}

/** 创建断路器 */
export function createCircuitBreaker(
  size: number,
  options?: { cooldownMs?: number; now?: () => number },
): CircuitBreaker {
  if (size < 1) throw new Error('circuit breaker needs at least 1 endpoint');
  const cooldown = options?.cooldownMs ?? 15_000;
  const now = options?.now ?? (() => Date.now());
  const downUntil: number[] = Array.from({ length: size }, () => 0);

  function pick(): number {
    const t = now();
    for (let i = 0; i < size; i += 1) {
      if (t >= downUntil[i]!) {
        downUntil[i] = 0; // 显式标记健康（清理过期时间戳）
        return i;
      }
    }
    // 全部处于冷却期：复位并回退最高优先级，避免全线不可用
    for (let i = 0; i < size; i += 1) downUntil[i] = 0;
    return 0;
  }

  function markDown(i: number): void {
    if (size <= 1) return; // 单端点无故障转移意义
    downUntil[i] = now() + cooldown;
  }

  return {
    pick,
    markDown,
    get size() {
      return size;
    },
    __downUntil: (i: number) => downUntil[i] ?? 0,
  };
}

/** 判断值是否为 thenable（Promise 或 postgres.js pending query） */
export function isThenable(value: unknown): value is { then: (...a: unknown[]) => unknown } {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * 给一个 thenable 包裹「reject 即回调 onReject」：
 * - `then/catch/finally` 被拦截，reject 时调用 onReject（仅一次）。
 * - 其余属性（如 pending query 的 `.values()/.cursor()`）原样转发，且其返回的新
 *   thenable 会递归包裹，保证整条链上的失败都能被捕获。
 */
export function guardThenable<T>(thenable: T, onReject: () => void): T {
  if (thenable === null || typeof thenable !== 'object') return thenable;
  let handled = false;
  const fire = () => {
    if (!handled) {
      handled = true;
      onReject();
    }
  };
  return new Proxy(thenable as object, {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig !== 'function') return orig;
        return (...args: unknown[]) => {
          if (prop === 'then') {
            const [onFulfilled, onRejected] = args as [unknown, unknown];
            const wrappedReject = (err: unknown) => {
              fire();
              return typeof onRejected === 'function' ? onRejected(err) : (() => {
                throw err;
              })();
            };
            return orig.call(target, onFulfilled, wrappedReject);
          }
          if (prop === 'catch') {
            return orig.call(target, (err: unknown) => {
              fire();
              return typeof args[0] === 'function' ? (args[0] as (e: unknown) => unknown)(err) : (() => {
                throw err;
              })();
            });
          }
          // finally：透传完成/失败，失败时仍触发 onReject
          return orig.call(target, args[0]).then(
            (v: unknown) => v,
            (err: unknown) => {
              fire();
              throw err;
            },
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      // 链式方法（如 .values()）返回新的 pending query，递归包裹其结果
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return isThenable(result) ? guardThenable(result, onReject) : result;
        };
      }
      return value;
    },
  }) as T;
}

/** 给 postgres.js 的 Sql 客户端挂断路器：拦截 `apply`（直接调用）与 `get`（.unsafe/.begin 等） */
export function guardSql<T extends object>(
  client: T,
  onReject: () => void,
): T {
  return new Proxy(client, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target as (...a: unknown[]) => unknown, thisArg as unknown, args);
      return isThenable(result) ? guardThenable(result, onReject) : result;
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return isThenable(result) ? guardThenable(result, onReject) : result;
        };
      }
      return value;
    },
  });
}
