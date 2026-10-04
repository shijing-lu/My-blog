/** A transient local HTTP failure must not hide a completed background sync. */
async function readSyncState(url, cookie, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const retries = options.retries ?? 3;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: cookie ? { cookie } : {},
        signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
      });
      if (response.status === 401 || response.status === 403) {
        const error = new Error('登录状态已失效，请在客户端重新登录后同步');
        error.authFailure = true;
        throw error;
      }
      if (!response.ok) throw new Error(`读取同步状态失败：HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.authFailure) throw error;
      lastError = error;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 300));
    }
  }
  throw new Error(`暂时无法读取同步状态：${lastError?.message || '请求失败'}。后台同步可能仍在执行，可稍后重试查看。`);
}
module.exports = { readSyncState };
