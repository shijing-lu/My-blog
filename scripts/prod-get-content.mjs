import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  // 先访问 doc 首页拿 bundle 列表
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2000);
  const links = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3))]);
  console.log('bundles:', links.length);
  const want = ['第11章', '第10章', '第9章 无穷', '第8章 常微分'];
  let found = [];
  for (const href of links) {
    const bid = href.split('/')[2];
    await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(1000);
    const arts = await p.evaluate(() => {
      const d = document.getElementById('doc-detail-data');
      if (!d) return [];
      try { return JSON.parse(d.dataset.nodes || '[]').filter((n) => n.kind === 'article').map((n) => ({ id: n.id, title: n.title })); } catch { return []; }
    });
    for (const a of arts) if (want.some((w) => a.title.includes(w))) found.push(a);
  }
  console.log('found:', JSON.stringify(found.map((f) => f.title), null, 0));
  // 试 GET content 公开性 + 拿一段源码
  for (const f of found.slice(0, 2)) {
    const r = await p.evaluate(async (id) => {
      try {
        const res = await fetch(`/api/doc/nodes/${id}`);
        if (res.status === 200) {
          const d = await res.json();
          const c = d?.node?.content ?? '';
          return { ok: true, len: c.length, head: c.slice(0, 300) };
        }
        return { ok: false, status: res.status };
      } catch (e) { return { ok: false, err: String(e).slice(0, 80) }; }
    }, f.id);
    console.log('GET', f.title.slice(0, 16), '=>', JSON.stringify(r).slice(0, 500));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
