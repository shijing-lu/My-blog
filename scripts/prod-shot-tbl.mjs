import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2000);
  const bundleIds = await p.evaluate(() => {
    const links = [...new Set([...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3))];
    return links.slice(0, 8).map((h) => h.split('/')[2]);
  });
  for (const bid of bundleIds) {
    await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(900);
    const meta = await p.evaluate(() => {
      const d = document.getElementById('doc-detail-data');
      if (!d) return [];
      try { return JSON.parse(d.dataset.nodes || '[]').filter((x) => x.kind === 'article').map((x) => ({ id: x.id, title: x.title })); } catch { return []; }
    });
    for (const a of meta) {
      if (a.title.includes('积分') && (a.title.includes('基础') || a.title.includes('基本') || a.title.includes('一元'))) {
        const r = await p.evaluate(async (id) => {
          const res = await fetch('/api/doc/nodes/' + id + '/render?t=' + Date.now());
          const d = await res.json();
          return d.html ?? '';
        }, a.id);
        const t = r.match(/<table[\s\S]*?<\/table>/);
        if (!t) continue;
        console.log('article', a.title, '| table含 katex:', t[0].includes('katex'), '| katex-html:', t[0].includes('katex-html'));
        const sample = t[0].match(/<span class="katex-html">[\s\S]{0,140}?<\/span>/);
        if (sample) console.log('  sample katex-html:', sample[0].slice(0, 160));
        await p.goto(`https://www.byqx-blog.online/doc/${bid}#${a.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.waitForTimeout(2500);
        // 滚到第一个含 katex 的表格
        await p.evaluate(() => {
          const t = document.querySelector('article.prose table');
          if (t) t.scrollIntoView({ block: 'center' });
        });
        await p.waitForTimeout(800);
        await p.screenshot({ path: '.diag/prod-table-formulas.png', fullPage: true });
        console.log('  shot .diag/prod-table-formulas.png (article:', a.title, ')');
        await b.close();
        return;
      }
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
