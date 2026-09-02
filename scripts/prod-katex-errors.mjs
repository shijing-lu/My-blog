import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.byqx-blog.online/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('article.prose', { timeout: 30000 });
  await p.waitForTimeout(2500);
  const out = await p.evaluate(() => {
    const errs = [...document.querySelectorAll('article.prose .katex')].filter((k) => k.querySelector('.katex-error'));
    const errInfo = errs.slice(0, 20).map((k) => {
      const e = k.querySelector('.katex-error');
      const ann = k.querySelector('annotation');
      return {
        errText: e ? e.textContent.slice(0, 200) : '',
        src: ann ? ann.textContent.slice(0, 200) : '',
        parent: (() => { let p = k; for (let i = 0; i < 4; i++) p = p.parentElement; return p ? p.textContent.slice(0, 100) : ''; })(),
      };
    });
    const totalKatex = document.querySelectorAll('article.prose .katex').length;
    const totalErr = errs.length;
    const allErrTypes = [...new Set(errInfo.map((e) => {
      const m = e.errText.match(/KaTeX (parse|render) error: ([^"]*?)(?="|$)/i);
      return m ? m[2] : 'UNKNOWN:' + e.errText.slice(0, 40);
    }))].slice(0, 12);
    return { totalKatex, totalErr, allErrTypes, samples: errInfo.slice(0, 5) };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
