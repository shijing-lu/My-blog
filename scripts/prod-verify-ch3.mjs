import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('https://www.byqx-blog.online/', { waitUntil: 'domcontentloaded' });
  // 直接访问第3章强化讲义文档（bundle 为含该 article 的册）
  const nodeId = '5d69ce83-0957-4b3b-a929-3c85ddc29f05';
  // 经 doc 页拿 bundle 链接再定位文章 render（API 直接测）
  const html = await p.evaluate(async (id) => {
    const r = await fetch('https://www.byqx-blog.online/api/doc/nodes/' + id + '/render?v=' + Date.now());
    const d = await r.json();
    return d.html ?? '';
  }, nodeId);
  const table = html.match(/<table[\s\S]*?<\/table>/);
  const seg = table ? table[0] : html;
  const katexInTable = (table ? table[0] : '').includes('katex');
  // 分式结构探测：frac-container / mfrac（KaTeX 分式结构类）
  const hasFrac = /class="[^"]*mfrac|frac-container|katex-html[^>]*>\s*<span[^>]*class="[^"]*mord/.test(seg);
  const literalBraces = (seg.match(/\{1\}\{|\{x\}/g) ?? []).length;
  console.log(JSON.stringify({
    katexInTable,
    fracElement: hasFrac,
    literalBraceOccurrences: literalBraces,
    katexHtmlSpans: (seg.match(/class="katex-html"/g) ?? []).length,
  }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
