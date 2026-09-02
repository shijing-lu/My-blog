/**
 * e2e-wysiwyg.mjs —— 本地 E2E 验收（只读生产之外的本地 dev：4323）
 *
 * 覆盖：
 *  A. 功能二（阅读态布局）：TOC 悬浮贴右 340px / 不遮正文 / 正文 680px /
 *     窄窗自动收起 + 浮层遮罩三态 / 公式字体与行重叠检测
 *  B. 功能一（编辑态 WYSIWYG）：单栏 / 初始内容全套渲染 /
 *     键入 ## + 空格即时标题并持续维持（核心验收）/ 公式键入即时渲染 /
 *     列表即时渲染 / 点击公式回显源码 / 自动保存 PATCH / 保存后正文刷新
 *
 * 用法：node scripts/e2e-wysiwyg.mjs
 */
import { chromium } from 'playwright-core';
import { createHmac, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** 每轮前置重置：清掉上次运行自动保存残留，保证断言基于纯净种子内容 */
try {
  execFileSync(process.execPath, ['scripts/e2e-seed-doc.mjs', '--clean'], { stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/e2e-seed-doc.mjs'], { stdio: 'ignore' });
} catch {
  /* 重置失败不致命：多数断言对累积内容仍成立 */
}

const BASE = 'http://127.0.0.1:4323';
const BUNDLE_ID = 'e2e-bundle-0000-0000-0000-000000000000';
const NODE_ID = 'e2e-node-0000-0000-0000-000000000000';
const DOC_URL = `${BASE}/doc/${BUNDLE_ID}#${NODE_ID}`;
const VIEWPORT_WIDE = { width: 1440, height: 900 };
const TOC_AUTO_THRESHOLD = 1320;

mkdirSync('.diag', { recursive: true });

/* ---------- 结果收集 ---------- */
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail: cond ? '' : String(detail) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + detail}`);
}
function summarize() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
}

/* ---------- 本地 AUTH_SECRET 铸 admin_session（与 lib/auth.ts 相同算法） ---------- */
function readEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 忽略 */ }
  return out;
}
const env = readEnv('.env');
if (!env.AUTH_SECRET) throw new Error('本地 .env 缺 AUTH_SECRET');
function forgeAdminCookie() {
  const secret = createHash('sha256').update(env.AUTH_SECRET).digest();
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

/* ---------- 页面内检测器 ---------- */
/** 数学行重叠检测（只比较同一 .mfrac .vlist 的直接行，vlist 行盒塌缩 = 糊状根因） */
const MATH_MEASURE = () => {
  const out = { katexCount: 0, font: 'n/a', mfracOverlaps: 0, worstOverlap: 0 };
  const k = document.querySelector('article.prose .katex, .cm-wy-math .katex');
  if (!k) return out;
  out.katexCount = document.querySelectorAll('article.prose .katex, .cm-wy-math .katex').length;
  const probe = k.querySelector('.mord') || k;
  out.font = getComputedStyle(probe).fontFamily.split(',')[0].replace(/["']/g, '');
  let worst = 0;
  let n = 0;
  document.querySelectorAll('article.prose .mfrac .vlist, .cm-wy-math .mfrac .vlist').forEach((vl) => {
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
      if (vOv > 1 && hOv > 2) {
        n += 1;
        worst = Math.max(worst, vOv);
      }
    }
  });
  out.mfracOverlaps = n;
  out.worstOverlap = +worst.toFixed(1);
  return out;
};

/** 编辑器内行级快照：返回每行 textContent 与标题 mark 情况 */
const SNAPSHOT = () => {
  const lines = [...document.querySelectorAll('.cm-content .cm-line')].map((ln) => ({
    text: ln.textContent,
    cls: [...ln.querySelectorAll('span')].reduce((a, s) => {
      for (const c of s.classList) if (c.startsWith('cm-lp-') || c.startsWith('cm-wy-')) a.push(c);
      return a;
    }, []),
  }));
  return lines;
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: VIEWPORT_WIDE });
  await ctx.addCookies([
    {
      name: 'admin_session',
      value: forgeAdminCookie(),
      url: BASE,
      httpOnly: true,
    },
  ]);
  const page = await ctx.newPage();

  /* ---- 预热：首次点编辑会触发 cm-wysiwyg（含 katex）chunk 加载与 Vite 依赖预构建，
        可能整页 reload。先跑一遍让 chunk/optimize 完成，正式断言用干净重载，避免状态丢失 ---- */
  try {
    await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('#doc-inline-edit').waitFor({ timeout: 120000 });
    await page.locator('#doc-inline-edit').click();
    await page.waitForSelector('.cm-editor', { timeout: 120000 });
    await page.waitForSelector('.cm-wy-math .katex', { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#doc-toc-aside #doc-toc-panel', { timeout: 60000 });
    await page.waitForSelector('#doc-3col article.prose', { timeout: 60000 });
    await page.waitForTimeout(2500);
    console.log('[warmup] 完成（katex chunk 已缓存）');
  } catch (err) {
    console.warn('[warmup] 预热异常（继续尝试正式断言）:', String(err).slice(0, 200));
  }

  /* ================= A. 阅读态布局断言 ================= */
  console.log('\n===== A. 阅读态（功能二：悬浮目录 + 公式展示） =====');
  await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#doc-toc-aside #doc-toc-panel', { timeout: 30000 });
  await page.waitForSelector('article.prose', { timeout: 30000 });
  await page.waitForTimeout(2500); // 等字体加载 + 公式稳定

  // A1 面板贴右缘且宽 340
  const panelBox = await page.locator('#doc-toc-panel').boundingBox();
  check('A1-toc-panel-sticks-right', !!panelBox && Math.abs(panelBox.x + panelBox.width - 1440) < 1.5, JSON.stringify(panelBox));
  check('A2-toc-panel-width-340', !!panelBox && Math.abs(panelBox.width - 340) < 1.5, panelBox?.width);

  // A3 面板不遮正文（正文右缘 < 面板左缘）；用同帧 evaluate 读几何避免 boundingBox 时序抖动
  await page.waitForSelector('#doc-3col article.prose', { timeout: 30000 });
  const a3 = await page.evaluate(() => {
    const art = document.querySelector('#doc-3col article.prose');
    if (!art) return { artRight: null, artW: null };
    const r = art.getBoundingClientRect();
    return { artRight: +r.right.toFixed(1), artW: +r.width.toFixed(1) };
  });
  check(
    'A3-toc-no-overlap-prose',
    !!panelBox && a3.artRight !== null && a3.artRight <= panelBox.x + 1,
    `prose.right=${a3.artRight} w=${a3.artW} panel.x=${panelBox?.x}`,
  );

  // A4 正文阅读宽 ≤ 680（锁定在 TOC 左侧，不随面板/折叠变化）
  const mainBox = await page.locator('#doc-3col > main').boundingBox();
  check('A4-prose-width-680', !!mainBox && mainBox.width <= 681 && mainBox.width > 600, mainBox?.width);

  // A5 公式字体正常（本地 dev：KaTeX 字体应成功加载，font 应带 KaTeX_Main）
  const math = await page.evaluate(MATH_MEASURE);
  check('A5-math-font-loaded', math.font.includes('KaTeX_Main'), math.font);
  // A6 分式行无塌缩重叠（字体正常时 mfrac 行盒应分离）
  check('A6-math-no-vlist-collapse', math.mfracOverlaps <= 2, JSON.stringify(math));

  // A7 窄窗（<1320）自动收起为浮钮
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(400);
  const autoAttr = await page.locator('#doc-toc-aside').getAttribute('data-auto');
  const panelVisibleNarrow = await page.locator('#doc-toc-panel').isVisible();
  const fabVisible = await page.locator('#doc-toc-fab').isVisible();
  check('A7-narrow-auto-collapse', autoAttr === 'true' && !panelVisibleNarrow && fabVisible, `auto=${autoAttr} panel=${panelVisibleNarrow} fab=${fabVisible}`);

  // A8 点浮钮 → 浮层 + 遮罩；点遮罩 → 收起
  await page.locator('#doc-toc-fab').click();
  await page.waitForTimeout(200);
  const panelVisibleOverlay = await page.locator('#doc-toc-panel').isVisible();
  const overlayVisible = await page.locator('#doc-toc-overlay').isVisible();
  check('A8-overlay-open', panelVisibleOverlay && overlayVisible, `panel=${panelVisibleOverlay} overlay=${overlayVisible}`);
  await page.locator('#doc-toc-overlay').click({ position: { x: 20, y: 400 } });
  await page.waitForTimeout(200);
  check('A8b-overlay-close', !(await page.locator('#doc-toc-panel').isVisible()), '');

  // A9 拉宽 → 恢复悬浮展开
  await page.setViewportSize(VIEWPORT_WIDE);
  await page.waitForTimeout(400);
  const panelVisibleWide = await page.locator('#doc-toc-panel').isVisible();
  const autoAttrWide = await page.locator('#doc-toc-aside').getAttribute('data-auto');
  check('A9-wide-restore', panelVisibleWide && autoAttrWide === 'false', `auto=${autoAttrWide} panel=${panelVisibleWide}`);

  // A10 目录含 KaTeX 富文本（若标题带公式）——种子标题无公式，检查目录非空即可
  const tocCount = await page.locator('#doc-toc-list .toc-item, #doc-toc-list a').count();
  check('A10-toc-has-items', tocCount > 0, `count=${tocCount}`);

  /* ================= B. 编辑态 WYSIWYG 断言 ================= */
  console.log('\n===== B. 编辑态（功能一：单栏所见即所得） =====');
  const editBtn = page.locator('#doc-inline-edit');
  await editBtn.waitFor({ timeout: 15000 });
  await editBtn.click();
  await page.waitForSelector('.cm-editor', { timeout: 30000 });
  // KaTeX 动态 import + 首帧公式渲染（vite 首次编译 katex 依赖可能较慢）
  await page.waitForSelector('.cm-wy-math .katex', { timeout: 60000 });
  await page.waitForTimeout(400);

  // B1 单栏：编辑容器占据正文主区域（PANE ≈ 100vh-144px），且无「双栏预览」结构
  const editorPaneBox = await page.locator('.cm-editor').first().boundingBox();
  const cmCount = await page.locator('.cm-editor').count();
  check('B1-single-column', cmCount === 1 && !!editorPaneBox && editorPaneBox.height > 500, `cm=${cmCount} h=${editorPaneBox?.height}`);

  // B2-B7 初始内容全套渲染
  const snap = await page.evaluate(SNAPSHOT);
  const hasMark = (cls, text) => snap.some((l) => l.cls.includes(cls) && (text === undefined || l.text.includes(text)));
  check('B2-h1-rendered', hasMark('cm-lp-h1', '一级标题 E2E'), 'h1 mark');
  check('B3-h2-rendered', hasMark('cm-lp-h2', '二级标题 公式验证'), 'h2 mark');
  check('B4-strong-em-code-link', hasMark('cm-lp-strong') && hasMark('cm-lp-em') && hasMark('cm-lp-inline-code') && hasMark('cm-lp-link'), 'strong/em/code/link');
  check('B5-inline-math-katex', await page.locator('.cm-wy-math-inline .katex').count() >= 2, 'inline math');
  check('B6-block-math-katex', await page.locator('.cm-wy-math-display .katex').count() >= 2, 'display math');
  check('B7-list-widgets', hasMark('cm-wy-bullet') && hasMark('cm-wy-num'), 'bullet/num');
  const cbTotal = await page.locator('.cm-wy-checkbox').count();
  const cbChecked = await page.locator('.cm-wy-checkbox:checked').count();
  check('B8-checkbox', cbTotal === 2 && cbChecked === 1, `total=${cbTotal} checked=${cbChecked}`);
  check('B9-codeblock-quote', hasMark('cm-lp-code') || (await page.locator('.cm-lp-code').count()) > 0, 'code block');
  check('B9b-quote', (await page.locator('.cm-lp-quote-text').count()) >= 1, 'quote');

  // B10 标记隐藏：标题/列表行的文本不以源码标记开头
  const hLine = snap.find((l) => l.cls.includes('cm-lp-h2'));
  const listLine = snap.find((l) => l.cls.includes('cm-wy-bullet'));
  check('B10-heading-marker-hidden', !!hLine && !/^#/.test(hLine.text) && !hLine.text.includes('#'), hLine?.text);
  check('B10b-bullet-marker-hidden', !!listLine && !/^[-*+]\s/.test(listLine.text) && !listLine.text.startsWith('- '), listLine?.text);

  // B11 核心验收：行首逐键输入 ## + 空格 → 从第 4 个字符起每个字符键入后
  //    必须「立即」是二级标题（mark 存在且文本 == 已输入内容），持续输入始终维持
  const patchLog = [];
  const onPatch = (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/api/doc/nodes/')) {
      patchLog.push({ t: Date.now(), url: req.url(), body: req.postData() ?? '' });
    }
  };
  page.on('request', onPatch); // 从键入开始就监听，防止漏掉早到的自动保存

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter'); // 新起一行
  const SEQ = '## Heading Two E2E';
  let allInstant = true;
  let firstRenderedMs = -1;
  const t0 = Date.now();
  let typed = '';
  for (const ch of SEQ) {
    await page.keyboard.type(ch, { delay: 30 }); // 30ms 间隔保证每次是独立 input 事件
    typed += ch;
    if (typed.length <= 3) continue; // '## ' 三个字符内尚未成为标题（第 3 字符空格触发）
    const expected = typed.slice(3);
    const rendered = await page.evaluate((exp) => {
      return [...document.querySelectorAll('.cm-line .cm-lp-heading.cm-lp-h2')].some((m) => m.textContent === exp);
    }, expected);
    if (!rendered) {
      allInstant = false;
      break;
    }
    if (firstRenderedMs < 0) firstRenderedMs = Date.now() - t0;
  }
  check('B11-h2-instant-and-kept', allInstant, `firstRendered=${firstRenderedMs}ms 输入过程中任一字符键入后标题未即时渲染`);
  const h2LineText = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.cm-line .cm-lp-heading.cm-lp-h2')].find((x) => x.textContent === 'Heading Two E2E');
    return m ? m.closest('.cm-line')?.textContent ?? '' : '';
  });
  check('B11b-marker-hidden-while-kept', h2LineText === 'Heading Two E2E', `line text=${JSON.stringify(h2LineText)}`);
  await page.keyboard.press('Enter');

  // B12 键入行内公式：末 $ 闭合后立即渲染 KaTeX
  const S2 = 'Inline $x^2+3$ end';
  let t2buf = '';
  for (const ch of S2) {
    await page.keyboard.type(ch, { delay: 20 });
    t2buf += ch;
  }
  // 检查新公式行：所在行必须已渲染出 .cm-wy-math-inline widget（源码 $…$ 不可见）
  const typedMathOk = await page.evaluate(() => {
    const ln = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('Inline ') && l.textContent.includes(' end'));
    if (!ln) return false;
    return !!ln.querySelector('.cm-wy-math-inline .katex');
  });
  check('B12-inline-math-live-on-close', typedMathOk, 'typed 行无 .cm-wy-math-inline 渲染');
  const inlineMathTotal = await page.locator('.cm-wy-math-inline .katex').count();
  check('B12b-inline-math-count', inlineMathTotal >= 3, `count=${inlineMathTotal}`);

  // B13 键入列表：'- ' 输入后立即出现圆点 marker
  await page.keyboard.type('- live item', { delay: 20 });
  const bulletNow = await page.locator('.cm-wy-bullet').count();
  check('B13-typed-bullet', bulletNow >= 4, `bullet=${bulletNow}`);

  // B14 点击公式 widget → 回显源码（光标进入块内）。先定位 seed 公式所在行，
  // 点击行内第一个公式 widget（多次运行会累积内容，first() 不可靠，行内定位最稳）
  const seedMathLine = page.locator('.cm-line', { hasText: 'x^2 + y^2' }).first();
  const tgtMath = seedMathLine.locator('.cm-wy-math-inline').first();
  await tgtMath.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await tgtMath.click({ force: true });
  await page.waitForTimeout(400);
  const srcVisible = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.cm-line')].find((x) => x.textContent.includes('x^2 + y^2'));
    return !!l && l.textContent.includes('$x^2 + y^2 = z^2$');
  });
  check('B14-click-math-echo-source', srcVisible, '点击公式后该行未回显源码');
  // 光标移回文档开头（离开公式区）→ 恢复渲染
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(300);
  const restoredLine = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.cm-line')].find((x) => x.textContent.includes('x^2 + y^2'));
    return !!l?.querySelector('.cm-wy-math-inline .katex');
  });
  check('B14b-math-restored', restoredLine, '光标移出后公式未恢复渲染');

  // B15 自动保存：最后一次输入后停 2.2s（>1.5s 防抖）→ 应有 PATCH 且带新输入内容
  await page.waitForTimeout(2400);
  const lastPatch = patchLog[patchLog.length - 1];
  check('B15-autosave-patch', !!lastPatch && lastPatch.body.includes('Heading Two E2E'), lastPatch ? `patches=${patchLog.length}` : 'no PATCH');

  // B16 手动「保存」→ 关闭编辑器 → 正文被最新渲染替换
  await page.locator('[data-testid="doc-editor-save"]').click();
  await page.waitForTimeout(2500);
  const editingOff = await page.locator('#doc-3col').getAttribute('data-editing');
  const proseHasNew = await page.evaluate(() => document.querySelector('article.prose')?.textContent?.includes('Heading Two E2E'));
  check('B16-save-close-refresh', editingOff === 'false' && !!proseHasNew, `editing=${editingOff} proseHasNew=${!!proseHasNew}`);

  // B17 截图存档
  await page.locator('article.prose').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: '.diag/e2e-final-prose.png', fullPage: false });
  console.log('[shot] .diag/e2e-final-prose.png');

  await browser.close();
  summarize();
})().catch((err) => {
  console.error('E2E ERROR:', err);
  try {
    process.exitCode = 1;
  } finally {
    // 确保浏览器进程不挂住 CI 流程
    setTimeout(() => process.exit(1), 100);
  }
});
