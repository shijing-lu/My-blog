import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.byqx-blog.online/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('#doc-3col article.prose', { timeout: 30000 });
  await p.waitForTimeout(2500);
  // 滚到含用户截图区域的「重积分」段
  const para = p.locator('article.prose h2:has-text("计算法")').first();
  if (await para.count()) {
    await para.scrollIntoViewIfNeeded();
    await p.waitForTimeout(500);
    await p.screenshot({ path: '.diag/prod-wide-relaxed.png' });
    console.log('shot .diag/prod-wide-relaxed.png');
  } else {
    await p.screenshot({ path: '.diag/prod-wide-relaxed.png' });
  }
  // 测量正文宽度
  const geo = await p.evaluate(() => {
    const a = document.querySelector('#doc-3col article.prose');
    const main = document.querySelector('#doc-3col > main');
    const panel = document.getElementById('doc-toc-panel');
    return {
      mainW: main ? +main.getBoundingClientRect().width.toFixed(0) : null,
      articleW: a ? +a.getBoundingClientRect().width.toFixed(0) : null,
      panelRight: panel ? +panel.getBoundingClientRect().right.toFixed(0) : null,
      panelX: panel ? +panel.getBoundingClientRect().x.toFixed(0) : null,
    };
  });
  console.log('geometry:', JSON.stringify(geo));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
