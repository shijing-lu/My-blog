/** Database checks, SSR and sync run outside Electron's window event loop. */
const { pathToFileURL } = require('node:url');
const { ensureLocalDb } = require('./local-db.cjs');
const [entryPath, localDbPath, templatePath] = process.argv.slice(2);
const send = (message) => process.parentPort.postMessage(message);

async function start() {
  const started = performance.now();
  ensureLocalDb(localDbPath, templatePath || null, (message) => send({ type: 'log', message }));
  send({ type: 'log', message: `本地库检查完成：${Math.round(performance.now() - started)}ms` });
  await import(pathToFileURL(entryPath).href);
  send({ type: 'ready' });
}

void start().catch((error) => {
  send({ type: 'startup-error', message: error.message || String(error) });
  process.exitCode = 1;
  // An import can have started timers/sockets before failing.
  setTimeout(() => process.exit(1), 100);
});
