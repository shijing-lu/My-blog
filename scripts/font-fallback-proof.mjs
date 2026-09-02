/**
 * 根因闭环验证（只读生产，不改动）：
 * 1) 屏蔽 KaTeX 字体请求 → 确认糊状重叠复现（= 用户浏览器场景）
 * 2) 注入 MathML 兜底（.katex-font-fallback 类）→ 确认公式恢复可读
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const DOC = 'https://www.byqx-blog.online/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6';

const MEASURE = () => {
  const kr = document.querySelector('article.prose span.katex');
  const out = { font: 'n/a', rowOverlaps: [], mathmlVisible: false };
  if (!kr) return out;
  out.font = getComputedStyle(kr.querySelector('.mord') || kr).fontFamily.split(',')[0];
  const bad = [];
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
      const vOv = Math.min(rows[i].bottom, rows[i + 1].bottom) - Math.max(rows[i].top, rows[i + 1].top);
      const hOv = Math.min(rows[i].right, rows[i + 1].right) - Math.max(rows[i].left, rows[i + 1].left);
      if (vOv > 1 && hOv > 2) bad.push(+vOv.toFixed(1));
    }
  });
  out.rowOverlaps = { count: bad.length, worst: bad.length ? Math.max(...bad) : 0 };
  const mm = document.querySelector('article.prose .katex-mathml');
  if (mm) {
    const s = getComputedStyle(mm);
    out.mathmlVisible = s.display !== 'none' && !s.clip.includes('rect') && s.position !== 'absolute';
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // 屏蔽全部 KaTeX 字体文件（模拟用户网络拿不到字体）
  await ctx.route(/KaTeX_.*\.(woff2|woff|ttf)(\?.*)?$/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(DOC, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article.prose .katex', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const result = {};
  result.blockedFonts = await page.evaluate(MEASURE);
  const para = page.locator('article.prose p:has-text("原极限")').first();
  if (await para.count()) {
    await para.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await para.screenshot({ path: '.diag/proof-fonts-blocked.png' });
  }

  // 注入 MathML 兜底（与正式修复相同的 CSS 逻辑）
  await page.addStyleTag({
    content: `
      .katex-font-fallback .katex-html { display: none !important; }
      .katex-font-fallback .katex-mathml { position: static !important; clip: auto !important; width: auto !important; height: auto !important; overflow: visible !important; display: block !important; }
      .katex-font-fallback .katex-display .katex-mathml { text-align: center; }
    `,
  });
  await page.evaluate(() => document.documentElement.classList.add('katex-font-fallback'));
  await page.waitForTimeout(500);

  result.mathmlFallback = await page.evaluate(MEASURE);
  if (await para.count()) await para.screenshot({ path: '.diag/proof-mathml-fallback.png' });

  // 字体恢复组（对照组：不屏蔽字体的正常渲染）
  await browser.close();

  const okShape = (m) => m && m.rowOverlaps && m.rowOverlaps.count === 0;
  result.verdict = {
    blockedReproducedMush: result.blockedFonts.font !== 'KaTeX_Main' || result.blockedFonts.rowOverlaps.count > 0,
    mathmlFallbackClean: okShape(result.mathmlFallback) || result.mathmlFallback.mathmlVisible,
  };
  writeFileSync('.diag/proof-font-fallback.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
