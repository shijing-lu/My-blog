import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  // 1) 文档首页列出 bundles
  await p.goto('https://www.byqx-blog.online/doc', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const links = await p.evaluate(() =>
    [...document.querySelectorAll('a[href*="/doc/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.split('/').length === 3),
  );
  const uniq = [...new Set(links ?? [])];
  console.log('bundle links:', uniq.length, uniq.slice(0, 8));
  // 2) 每个 bundle 页读取注入 nodes meta，挑最近 updatedAt 的节点，逐节点 render 查 katex-error
  const bundleIds = uniq.map((h) => h.split('/')[2]).filter((x) => x && !x.includes('?'));
  const recent = [];
  for (const bid of bundleIds.slice(0, 30)) {
    try {
      await p.goto(`https://www.byqx-blog.online/doc/${bid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(1200);
      const meta = await p.evaluate(() => {
        const d = document.getElementById('doc-detail-data');
        if (!d) return null;
        try {
          const nodes = JSON.parse(d.dataset.nodes || '[]');
          return nodes.map((n) => ({ id: n.id, title: n.title, kind: n.kind, updatedAt: n.updatedAt }));
        } catch { return null; }
      });
      if (!meta) continue;
      for (const n of meta.filter((x) => x.kind === 'article')) recent.push({ ...n, bundle: bid });
    } catch { /* 单个 bundle 失败跳过 */ }
  }
  recent.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  console.log('articles scanned:', recent.length);
  const top = recent.slice(0, 8);
  console.log('top recent:', top.map((t) => ({ title: t.title?.slice(0, 20), upd: t.updatedAt })));
  // 3) 逐个 render 检查 katex-error
  for (const n of top) {
    try {
      const rr = await p.evaluate(async (id) => {
        const r = await fetch(`/api/doc/nodes/${id}/render?probe=` + Date.now());
        if (!r.ok) return { err: 'http' + r.status };
        const d = await r.json();
        const html = typeof d.html === 'string' ? d.html : '';
        const m = html.match(/<span class="katex-error[^"]*"[^>]*>([\s\S]{0,140}?)<\/span>/);
        return { hasErr: html.includes('katex-error'), errMsg: m ? m[1] : '', len: html.length };
      }, n.id);
      if (rr.hasErr) console.log('!! katex-error in', n.title, '=>', rr.errMsg?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').slice(0, 140));
      else console.log('ok', (n.title || '').slice(0, 24), rr.hasErr ? 'ERR' : 'clean', 'len', rr.len);
    } catch { /* */ }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
