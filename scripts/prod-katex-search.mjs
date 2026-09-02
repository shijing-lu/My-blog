import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.byqx-blog.online/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6?_=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('article.prose', { timeout: 30000 });
  await p.waitForTimeout(2500);
  const out = await p.evaluate(() => {
    const katexAll = [...document.querySelectorAll('article.prose .katex')];
    // 读 annotation 找含 L_1、Gamma_1、Sigma_1、bmatrix、vmatrix、\dfrac 等用户红字里出现的宏
    const find = (needle) => katexAll.filter((k) => {
      const ann = k.querySelector('annotation');
      return ann && ann.textContent.includes(needle);
    }).length;
    return {
      total: katexAll.length,
      L_1: find('L_1'),
      Gamma_1: find('Gamma_1'),
      Sigma_1: find('Sigma_1'),
      bmatrix: find('bmatrix'),
      vmatrix: find('vmatrix'),
      dfrac: find('\\dfrac'),
      iint: find('\\iint'),
      cases: find('cases'),
      anyError: katexAll.filter((k) => k.querySelector('.katex-error')).length,
      errorSamples: katexAll.filter((k) => k.querySelector('.katex-error')).slice(0, 3).map((k) => ({
        errText: k.querySelector('.katex-error').textContent.slice(0, 150),
      })),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
