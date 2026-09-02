import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  const want = ['第11章 多元', '第10章 向量', '第9章 无穷', '第8章 常微分', '第7章 二重', '第1章 函数'];
  let saved = 0;
  for (const w of want) {
    const nodeId = w.includes('第11章') ? null : w.includes('第10章') ? null : w.includes('第9章') ? null : w.includes('第8章') ? null : null;
  }
  // 直接经 doc 首页 bundle 收集
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2000);
  const links = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3))]);
  const all = new Map();
  for (const href of links) {
    const bid = href.split('/')[2];
    await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(900);
    const arts = await p.evaluate(() => {
      const d = document.getElementById('doc-detail-data');
      if (!d) return [];
      try { return JSON.parse(d.dataset.nodes || '[]').filter((n) => n.kind === 'article').map((n) => ({ id: n.id, title: n.title })); } catch { return []; }
    });
    for (const a of arts) if (want.some((x) => a.title.includes(x))) all.set(a.title.slice(0, 12), a.id);
  }
  for (const [key, id] of all) {
    const c = await p.evaluate(async (nid) => {
      const r = await fetch(`/api/doc/nodes/${nid}`);
      if (!r.ok) return '';
      const d = await r.json();
      return d?.node?.content ?? '';
    }, id);
    if (c) { writeFileSync(`.diag/doc-src-${key}.md`, c); saved++; console.log('saved', key, c.length); }
  }
  await b.close();
  console.log('total saved', saved);
})().catch(e => { console.error(e); process.exit(1); });
