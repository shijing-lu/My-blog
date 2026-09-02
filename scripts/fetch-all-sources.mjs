/** 拉取生产全部 doc article 源码到 .diag/full-src/<title>.md（只读） */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
mkdirSync('.diag/full-src', { recursive: true });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const links = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3))]);
  let n = 0;
  for (const href of links) {
    const bid = href.split('/')[2];
    await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(800);
    const arts = await p.evaluate(() => {
      const d = document.getElementById('doc-detail-data');
      if (!d) return [];
      try { return JSON.parse(d.dataset.nodes || '[]').filter((x) => x.kind === 'article').map((x) => ({ id: x.id, title: x.title, upd: x.updatedAt })); } catch { return []; }
    });
    for (const a of arts) {
      const c = await p.evaluate(async (nid) => {
        const r = await fetch(`/api/doc/nodes/${nid}`);
        if (!r.ok) return null;
        const d = await r.json();
        return d?.node?.content ?? null;
      }, a.id);
      if (typeof c === 'string') {
        const safe = (a.title || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
        const path = `.diag/full-src/${a.id}_${safe}.md`;
        if (!existsSync(path)) writeFileSync(path, c);
        n += 1;
      }
    }
  }
  await b.close();
  console.log('total articles saved:', n);
})().catch((e) => { console.error(e); process.exit(1); });
