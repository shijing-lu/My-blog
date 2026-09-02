/**
 * 生产只读验收：导航 + 几何 + 公式 + 截图；不键入不保存，绝不污染生产数据。
 */
import { chromium } from 'playwright-core';

const PROD = 'https://www.byqx-blog.online';
const DOC = `${PROD}/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6`;

const results = [];
const check = (n, ok, d='') => { results.push({n, ok}); console.log(`${ok?'PASS':'FAIL'} ${n}${ok?'':'  <- '+d}`); };

const MEASURE = () => {
  const out = { font: 'n/a', mfracOverlaps: 0, worstOverlap: 0, katex: 0 };
  const k = document.querySelector('article.prose .katex');
  if (!k) return out;
  out.katex = document.querySelectorAll('article.prose .katex').length;
  out.font = getComputedStyle(k.querySelector('.mord') || k).fontFamily.split(',')[0].replace(/["']/g, '');
  let n = 0, worst = 0;
  document.querySelectorAll('article.prose .mfrac .vlist').forEach((vl) => {
    const rows = [];
    vl.querySelectorAll(':scope > span').forEach((row) => {
      const inner = [...row.children].find((c) => !c.classList.contains('pstrut'));
      if (!inner) return;
      const r = inner.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      rows.push(r);
    });
    for (let i = 0; i + 1 < rows.length; i++) {
      const vOv = Math.min(rows[i].bottom, rows[i+1].bottom) - Math.max(rows[i].top, rows[i+1].top);
      const hOv = Math.min(rows[i].right, rows[i+1].right) - Math.max(rows[i].left, rows[i+1].left);
      if (vOv > 1 && hOv > 2) { n++; worst = Math.max(worst, vOv); }
    }
  });
  out.mfracOverlaps = n; out.worstOverlap = +worst.toFixed(1);
  return out;
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(DOC, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article.prose', { timeout: 30000 });
  await page.waitForTimeout(3000); // 字体加载 + 公式稳定

  // 1) 1440 视口：TOC 贴右 340
  const panel = await page.evaluate(() => {
    const p = document.getElementById('doc-toc-panel');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: +r.x.toFixed(1), w: +r.width.toFixed(1), right: +r.right.toFixed(1) };
  });
  check('prod-toc-sticks-right', !!panel && Math.abs(panel.right - 1440) < 1.5, JSON.stringify(panel));
  check('prod-toc-width-340', !!panel && Math.abs(panel.w - 340) < 1.5, panel?.w);

  // 2) 正文不与面板重叠
  const prose = await page.evaluate(() => {
    const a = document.querySelector('#doc-3col article.prose');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { right: +r.right.toFixed(1), w: +r.width.toFixed(1) };
  });
  check('prod-prose-no-overlap', !!prose && !!panel && prose.right <= panel.x + 1, JSON.stringify(prose));

  // 3) 正文阅读宽 ≤ 680
  check('prod-prose-width-680', !!prose && prose.w <= 681 && prose.w > 600, prose?.w);

  // 4) 公式字体加载 + 无 mfrac 塌缩
  const m = await page.evaluate(MEASURE);
  check('prod-math-font', m.font.includes('KaTeX_Main'), m.font);
  check('prod-math-no-collapse', m.mfracOverlaps <= 2, JSON.stringify(m));

  // 5) 截图存档（宽屏阅读态）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.diag/prod-wide.png' });
  console.log('shot .diag/prod-wide.png');

  // 6) 1100 视口：自动收起为浮钮
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(500);
  const auto = await page.evaluate(() => ({
    auto: document.getElementById('doc-toc-aside')?.dataset.auto,
    panelVisible: !document.getElementById('doc-toc-panel')?.hasAttribute('hidden') &&
                  getComputedStyle(document.getElementById('doc-toc-panel')).display !== 'none',
    fabVisible: getComputedStyle(document.getElementById('doc-toc-fab')).display !== 'none',
  }));
  check('prod-narrow-auto', auto.auto === 'true' && !auto.panelVisible && auto.fabVisible, JSON.stringify(auto));
  await page.screenshot({ path: '.diag/prod-narrow.png' });
  console.log('shot .diag/prod-narrow.png');

  // 7) 拉宽恢复悬浮
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => ({
    auto: document.getElementById('doc-toc-aside')?.dataset.auto,
    panelVisible: getComputedStyle(document.getElementById('doc-toc-panel')).display !== 'none',
  }));
  check('prod-wide-restore', wide.auto === 'false' && wide.panelVisible, JSON.stringify(wide));

  // 8) 公式段落定位截图（用户原糊状区域）
  const limPara = page.locator('article.prose p:has-text("原极限")').first();
  if (await limPara.count()) {
    await limPara.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await limPara.screenshot({ path: '.diag/prod-formula-limit.png' });
    console.log('shot .diag/prod-formula-limit.png');
  }

  // 9) 进入编辑态查看渲染（不键入不保存，仅查看）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const editBtn = page.locator('#doc-inline-edit');
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForSelector('.cm-wy-math .katex', { timeout: 60000 });
    await page.waitForTimeout(2000);
    const cm = await page.evaluate(() => ({
      lines: document.querySelectorAll('.cm-content .cm-line').length,
      inlineMath: document.querySelectorAll('.cm-wy-math-inline .katex').length,
      displayMath: document.querySelectorAll('.cm-wy-math-display .katex').length,
      bullets: document.querySelectorAll('.cm-wy-bullet').length,
      headings: document.querySelectorAll('.cm-lp-heading').length,
    }));
    console.log('editor render snapshot:', JSON.stringify(cm));
    check('prod-editor-renders-all', cm.inlineMath > 0 && cm.displayMath > 0 && cm.bullets > 0 && cm.headings > 0, JSON.stringify(cm));
    await page.screenshot({ path: '.diag/prod-editor.png' });
    console.log('shot .diag/prod-editor.png');
    // 取消关闭（不保存）：直接 reload 退出编辑态最安全
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    console.log('skip: doc-inline-edit not present (no auth)');
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n===== ${results.length - failed}/${results.length} production checks passed =====`);
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error('PROD VERIFY ERROR:', e); process.exit(1); });
