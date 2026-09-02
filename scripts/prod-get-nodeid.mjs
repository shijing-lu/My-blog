import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('https://www.byqx-blog.online/doc/b950ad87-f22a-495c-bde7-957c84282907', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2000);
  const meta = await p.evaluate(() => {
    const d = document.getElementById('doc-detail-data');
    if (!d) return [];
    try { return JSON.parse(d.dataset.nodes || '[]').map((n) => ({ id: n.id, title: n.title })); } catch { return []; }
  });
  const art = meta.filter((m) => m.title.includes('多元函数积分'));
  console.log(JSON.stringify(art.slice(0, 6)));
  // 直接 curl 第一条 render 检查错误
  if (art[0]) {
    const rr = await p.evaluate(async (id) => {
      const r = await fetch(`/api/doc/nodes/${id}/render?probe=` + Date.now());
      const d = await r.json();
      const html = typeof d.html === 'string' ? d.html : '';
      const m = html.match(/<span class="katex-error[^"]*"[^>]*>([\s\S]{0,200}?)<\/span>/);
      return { hasErr: html.includes('katex-error'), snippet: m ? m[1] : '' };
    }, art[0].id);
    console.log('node', art[0].id, JSON.stringify(rr.snippet ? { err: rr.snippet.replace(/&amp;/g, '&') } : rr));
    // content 公开性
    const cr = await p.evaluate(async (id) => {
      const r = await fetch(`/api/doc/nodes/${id}`);
      if (r.ok) { const d = await r.json(); return { ok: true, len: d?.node?.content?.length }; }
      return { ok: false, status: r.status };
    }, art[0].id);
    console.log('content GET:', JSON.stringify(cr));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
