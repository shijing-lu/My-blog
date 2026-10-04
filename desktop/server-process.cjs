/** Own one utility process, including startup failure, timeout and app shutdown. */
function startServerProcess({ fork, modulePath, args, env, cwd, log = () => {}, onExit = () => {}, timeoutMs = 30000 }) {
  const child = fork(modulePath, args, { env, cwd, stdio: 'pipe', serviceName: '白衣卿相本地服务' });
  let ready = false;
  let stopped = false;
  let settled = false;
  let timer;
  const started = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
      stop();
    };
    timer = setTimeout(() => fail(new Error('本地服务初始化超时（30 秒）')), timeoutMs);
    child.on('message', (message) => {
      if (message?.type === 'log') log(message.message);
      if (message?.type === 'startup-error') fail(new Error(message.message));
      if (message?.type === 'ready' && !settled) {
        settled = true;
        ready = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      if (!settled) fail(new Error(`本地服务进程提前退出（${code}）`));
      else if (ready && !stopped) onExit(code);
    });
  });
  // Drain both pipes so a verbose server cannot stall waiting for stdout.
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (data) => log(`[server] ${String(data).trim().slice(0, 500)}`));
  function stop() {
    if (stopped) return;
    stopped = true;
    child.kill();
  }
  return { started, stop };
}

module.exports = { startServerProcess };
