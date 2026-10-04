/** 合并并发保存；请求期间新增的内容会在当前请求完成后继续保存。 */
export function createLatestSaveQueue<T>(read: () => T, write: (snapshot: T) => Promise<void>): { flush(): Promise<T> } {
  let pending: Promise<T> | null = null;
  const drain = async (): Promise<T> => {
    let snapshot = read();
    for (;;) {
      await write(snapshot);
      const latest = read();
      if (Object.is(latest, snapshot)) return snapshot;
      snapshot = latest;
    }
  };
  return {
    flush() {
      if (!pending) {
        const task = drain();
        pending = task;
        const clear = (): void => { if (pending === task) pending = null; };
        // 同时处理成功与失败，避免 finally 派生出未捕获的拒绝 Promise。
        void task.then(clear, clear);
      }
      return pending;
    },
  };
}
