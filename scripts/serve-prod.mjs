/**
 * 本地生产服务器（脚本用途：跑真正的生产 Lighthouse）
 *
 * 包装 Vercel 生产构建产物：
 * - 静态资源（_astro/*、favicon.svg、themes/*）从 dist/client 直接输出；
 * - 其余/API 交给 .vercel/output/functions/_render.func 的 Web 处理器（fetch(request)）。
 * 启动：node scripts/serve-prod.mjs   （端口 4325）
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const staticDir = join(root, 'dist/client');
const PORT = 4325;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

let handler;
try {
  const entryPath = join(root, '.vercel/output/functions/_render.func/dist/server/entry.mjs');
  const entry = await import(pathToFileURL(entryPath).href);
  handler = entry.default;
} catch (err) {
  console.error('[serve-prod] 无法加载生产入口（请先 pnpm build）:', err.message);
  process.exit(1);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  // 静态资源
  if (path.startsWith('/_astro/') || path === '/favicon.svg' || path.startsWith('/themes/')) {
    try {
      const buf = await readFile(join(staticDir, path.slice(1)));
      res.writeHead(200, { 'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
      return;
    } catch {
      // 落到函数处理（404）
    }
  }

  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await collectBody(req);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, String(v));
    }
    headers.set('x-forwarded-for', '127.0.0.1');
    headers.set('x-astro-path', path);
    const request = new Request(`http://localhost:${PORT}${path}`, { method: req.method, headers, body });
    const response = await handler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('[serve-prod] 处理错误:', err?.message || err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`[serve-prod] 生产服务器运行于 http://localhost:${PORT}`);
});
