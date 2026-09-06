/** 生产全库只读复扫：render 状态 + katex-error */
import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const links = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3))]);
  let ok = 0, httpErr = 0, katexErr = 0, total = 0;
  const bad = [];
  for (const href of links) {
    const bid = href.split('/')[2];
    await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(700);
    const arts = await p.evaluate(() => {
      const d = document.getElementById('doc-detail-data');
      if (!d) return [];
      try { return JSON.parse(d.dataset.nodes || '[]').filter((x) => x.kind === 'article').map((x) => ({ id: x.id, title: x.title })); } catch { return []; }
    });
    for (const a of arts) {
      total += 1;
      const r = await p.evaluate(async (id) => {
        try {
          const res = await fetch(`/api/doc/nodes/${id}/render?scan=` + Date.now());
          if (!res.ok) return { status: res.status };
          const d = await res.json();
          const html = typeof d.html === 'string' ? d.html : '';
          return { status: 200, err: html.includes('katex-error') };
        } catch { return { status: -1 }; }
      }, a.id);
      if (r.status !== 200) { httpErr++; bad.push(a.title.slice(0, 22) + ' http=' + r.status); }
      else { ok++; if (r.err) { katexErr++; bad.push(a.title.slice(0, 22) + ' katex-error'); } }
    }
  }
  console.log(JSON.stringify({ total, ok, httpErr, katexErr, bad: bad.slice(0, 8) }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
