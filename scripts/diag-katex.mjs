/**
 * 公式挤压/重叠诊断脚本（只读，不改任何数据）
 *
 * 用法：
 *   node scripts/diag-katex.mjs                    # 默认打生产站（A/B/D 场景）
 *   BLOG_BASE=http://localhost:4323 node scripts/diag-katex.mjs   # 打本地 dev
 *
 * 场景：
 *   A = 阅读页 1045×800（用户窗口宽）
 *   B = 阅读页 1440×900
 *   D = TOC 面板内条目（同一页面，只扫 #doc-toc-rail）
 *   额外：点击左栏切换到第 2 篇文章再扫一遍（覆盖 SSR 之外的文章）
 *
 * 检测器：
 *   1) 分式重叠：.vlist 各行（.vlist>span>span，排除 .pstrut）两两 boundingRect
 *      垂直相交>1px 且水平重叠>2px → 重叠
 *   2) 横向切断：.katex-display scrollWidth > clientWidth+2
 *   3) 右缘越界：.katex 叶子 rect.right > 块容器 rect.right+1
 *   4) 字体：document.fonts.check('1em KaTeX_*') + computed fontFamily
 *
 * 输出：JSON 报告 + 截图到 .diag/
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BLOG_BASE || 'https://www.byqx-blog.online';
const DOC_URL = `${BASE}/doc/91a943b7-f273-4a1c-a84d-21fd59b3f7c6`; // 高等数学（公式最密）
const OUT_DIR = '.diag';
mkdirSync(OUT_DIR, { recursive: true });

async function scanPage(page, label) {
  const r = await page.evaluate(() => {
    /* ---------- 检测器（纯只读） ---------- */
    function fracOverlap(rootSel) {
      const root = rootSel ? document.querySelector(rootSel) : document;
      if (!root) return { count: 0, issues: [], scanned: 0 };
      const vlists = root.querySelectorAll('.katex .vlist-t');
      const issues = [];
      for (const vt of vlists) {
        const rows = [];
        for (const rowSpan of vt.querySelectorAll('.vlist > span')) {
          const inner = [...rowSpan.children].find((c) => !c.classList.contains('pstrut'));
          if (!inner) continue;
          const r = inner.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          rows.push({ el: inner, r });
        }
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i].r, b = rows[j].r;
            const vOv = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            const hOv = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            if (vOv > 1 && hOv > 2) {
              issues.push({ vOverlap: +vOv.toFixed(1), hOverlap: +hOv.toFixed(1), a: rows[i].el.textContent.slice(0, 40), b: rows[j].el.textContent.slice(0, 40) });
              if (issues.length >= 8) return { count: issues.length, issues, scanned: vlists.length };
            }
          }
        }
      }
      return { count: issues.length, issues, scanned: vlists.length };
    }
    function clipDisplay(rootSel) {
      const root = rootSel ? document.querySelector(rootSel) : document;
      if (!root) return { count: 0, issues: [] };
      const issues = [];
      for (const d of root.querySelectorAll('.katex-display')) {
        if (d.scrollWidth > d.clientWidth + 2) {
          issues.push({ scrollW: d.scrollWidth, clientW: d.clientWidth, text: d.textContent.slice(0, 40) });
          if (issues.length >= 8) break;
        }
      }
      return { count: issues.length, issues };
    }
    function rightOverflow(rootSel) {
      const root = rootSel ? document.querySelector(rootSel) : document;
      if (!root) return { count: 0, issues: [] };
      const issues = [];
      const blocks = new Set();
      for (const k of root.querySelectorAll('.katex')) {
        const block = k.closest('p, li, h1, h2, h3, h4, .toc-item, .katex-display') || k.parentElement;
        if (!block || blocks.has(block)) continue;
        blocks.add(block);
        const br = block.getBoundingClientRect();
        let worst = 0, text = '';
        for (const leaf of k.querySelectorAll('.katex-html span')) {
          const r = leaf.getBoundingClientRect();
          if (r.width === 0) continue;
          const over = r.right - br.right;
          if (over > worst) { worst = over; text = leaf.textContent.slice(0, 30); }
        }
        if (worst > 1) issues.push({ over: +worst.toFixed(1), block: block.className.slice(0, 40), text });
      }
      return { count: issues.length, issues: issues.slice(0, 8) };
    }
    function fontReport() {
      const names = ['KaTeX_Main', 'KaTeX_Math-Italic', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4'];
      const out = { status: document.fonts ? document.fonts.status : 'no-fonts-api', loaded: [] };
      for (const n of names) {
        try { out.loaded.push({ name: n, ok: document.fonts.check(`1em "${n}"`) }); } catch { out.loaded.push({ name: n, ok: 'err' }); }
      }
      const mord = document.querySelector('.katex .mord');
      out.sampleFontFamily = mord ? getComputedStyle(mord).fontFamily.slice(0, 80) : 'none';
      return out;
    }
    function tocGeo() {
      const aside = document.getElementById('doc-toc-aside');
      const article = document.querySelector('main article');
      if (!aside) return { present: false };
      const a = aside.getBoundingClientRect();
      const m = article ? article.getBoundingClientRect() : null;
      return {
        present: true,
        aside: { left: +a.left.toFixed(0), right: +a.right.toFixed(0), width: +a.width.toFixed(0), innerWidth: window.innerWidth },
        tocRightAtViewportEdge: Math.abs(a.right - window.innerWidth) < 2,
        prose: m ? { width: +m.width.toFixed(0) } : null,
        asideOverlapsProse: m ? a.left < m.right && a.right > m.left : null,
      };
    }

    const body = { scope: 'body', fracOverlap: fracOverlap(null), clipDisplay: clipDisplay(null), rightOverflow: rightOverflow(null) };
    const toc = { scope: '#doc-toc-rail', fracOverlap: fracOverlap('#doc-toc-rail'), clipDisplay: clipDisplay('#doc-toc-rail'), rightOverflow: rightOverflow('#doc-toc-rail') };
    return { body, toc, fonts: fontReport(), tocGeo: tocGeo() };
  }).catch((e) => ({ error: String(e) }));

  // 定位「原极限」公式所在区域截图（用户截图 2 的目标）
  try {
    const el = await page.$('text=原极限');
    if (el) await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  } catch { /* 找不到就不截 */ }
  await page.screenshot({ path: `${OUT_DIR}/diag-${label}.png` });
  return r;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { base: BASE, docUrl: DOC_URL, scenarios: {} };

  for (const [label, vp] of [['A-1045', { width: 1045, height: 800 }], ['B-1440', { width: 1440, height: 900 }]]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('article.prose .katex', { timeout: 30000 });
    await page.waitForTimeout(800); // 字体渲染稳定
    await page.evaluate(() => document.fonts?.ready);
    report.scenarios[label] = await scanPage(page, label);

    // 切换到第 2 篇文章（第2章 微分学），覆盖非 SSR 首篇的渲染（GET render，只读）
    try {
      await page.click('[data-article-switch]:has-text("第2章")', { timeout: 8000 });
      await page.waitForTimeout(4000);
      const hasKatex = await page.$('article.prose .katex');
      if (hasKatex) {
        report.scenarios[`${label}-ch2`] = await scanPage(page, `${label}-ch2`);
      } else {
        report.scenarios[`${label}-ch2`] = { note: '第2章未加载出公式' };
      }
    } catch (e) {
      report.scenarios[`${label}-ch2`] = { note: `切换失败: ${String(e).slice(0, 120)}` };
    }
    await page.close();
  }

  await browser.close();

  // 汇总判定
  const flat = JSON.stringify(report.scenarios);
  const anyOverlap = /"count":[1-9]/.test(flat);
  const allFontOk = Object.values(report.scenarios)
    .filter((s) => s && s.fonts)
    .every((s) => s.fonts.loaded.every((f) => f.ok === true));
  report.verdict = {
    anyOverlapOrClip: anyOverlap,
    allKaTeXFontsLoaded: allFontOk,
    conclusion: anyOverlap
      ? '本机可复现重叠/切断 → 按场景归属修复（看 scenarios 明细）'
      : allFontOk
        ? '四场景全零且字体正常 → 判定用户侧字体加载失败，走字体韧性方案'
        : '本机字体也异常 → 先查字体加载',
  };

  writeFileSync(`${OUT_DIR}/diag-katex-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.verdict, null, 2));
  for (const [k, s] of Object.entries(report.scenarios)) {
    if (!s || !s.body) { console.log(`\n[${k}]`, JSON.stringify(s).slice(0, 200)); continue; }
    console.log(`\n[${k}] frac=${s.body.fracOverlap.count} clip=${s.body.clipDisplay.count} overflow=${s.body.rightOverflow.count} | TOC frac=${s.toc.fracOverlap.count} clip=${s.toc.clipDisplay.count} | fonts=${s.fonts.loaded.map((f) => `${f.name}:${f.ok}`).join(',')} | tocGeo=${JSON.stringify(s.tocGeo)}`);
    if (s.body.fracOverlap.issues?.length) console.log('  OVERLAP:', JSON.stringify(s.body.fracOverlap.issues.slice(0, 3)));
    if (s.body.clipDisplay.issues?.length) console.log('  CLIP:', JSON.stringify(s.body.clipDisplay.issues.slice(0, 3)));
  }
})().catch((e) => { console.error('DIAG ERROR:', e); process.exit(1); });
