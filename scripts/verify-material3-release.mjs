/** Read-only release check for the website or the installed desktop's local service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:43221';
const label = process.argv[3] || 'release';
assert.match(label, /^[a-z0-9-]+$/);
const output = path.resolve('outputs/material3-review');
fs.mkdirSync(output, { recursive: true });
const settings = await fetch(base + '/api/ui-style', { signal: AbortSignal.timeout(30000) });
assert.equal(settings.status, 200);
assert.match(settings.headers.get('cache-control'), /no-store/);
const defaultStyle = (await settings.json()).defaultStyle;
assert.ok(['classic', 'material3'].includes(defaultStyle));
const forbidden = await fetch(base + '/api/ui-style', {
  method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ defaultStyle }), signal: AbortSignal.timeout(30000),
});
assert.ok([401, 403].includes(forbidden.status), 'visitors cannot write the site preference');
const report = { base, defaultStyle, visitorWriteStatus: forbidden.status, pages: [], errors: [], writes: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const style of ['classic', 'material3']) for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(value => {
      localStorage.setItem('my-blog-theme', JSON.stringify({ uiStyle: value, mode: 'light', themeId: '' }));
      requestAnimationFrame(() => { window.__materialFirstFrame = document.documentElement.dataset.uiStyle; });
    }, style);
    await context.route('**/api/**', route => {
      if (/^(POST|PUT|PATCH|DELETE)$/.test(route.request().method())) {
        report.writes.push(new URL(route.request().url()).pathname);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ style, width, message: error.message }));
    for (const url of ['/', '/doc', '/design/material3']) {
      const response = await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      assert.equal(response?.status(), 200);
      await page.waitForFunction(expected => document.documentElement.dataset.uiStyle === expected, style);
      await page.evaluate(() => document.fonts.ready);
      const entry = await page.evaluate(({ url, style, width }) => ({
        url, style, width, firstFrame: window.__materialFirstFrame,
        documentWidth: document.documentElement.scrollWidth,
        font: getComputedStyle(document.body).fontFamily,
        loadedFonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
        navigation: performance.getEntriesByType('navigation').map(entry => ({
          domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd), responseMs: Math.round(entry.responseEnd),
        })),
        resources: performance.getEntriesByType('resource').filter(entry => /\.(woff2|css|js)(\?|$)/.test(entry.name))
          .map(entry => ({ file: new URL(entry.name).pathname, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
      }), { url, style, width });
      assert.equal(entry.firstFrame, style, 'the selected style must be applied before the first animation frame');
      assert.ok(entry.documentWidth <= width + 1, `${style}/${width} ${url} overflow ${entry.documentWidth}`);
      if (style === 'material3') {
        assert.match(entry.font, /Roboto/);
        assert.ok(entry.loadedFonts.some(font => font.includes('Material Symbols')), 'packaged icons load');
        assert.ok(entry.loadedFonts.some(font => font.includes('Noto Sans SC')), 'packaged Chinese font loads');
      }
      if (url === '/design/material3') {
        await page.locator('[data-material-component-demo]').waitFor();
        entry.screenshot = `${label}-design-${style}-${width}.png`;
        await page.screenshot({ path: path.join(output, entry.screenshot), fullPage: false });
      }
      report.pages.push(entry);
      console.log(`MATERIAL_RELEASE_PAGE_OK ${label} ${style} ${width} ${url}`);
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.writes, []);
  fs.writeFileSync(path.join(output, `${label}-verification.json`), JSON.stringify(report, null, 2));
  console.log(`MATERIAL_RELEASE_OK ${label} pages=${report.pages.length} no-content-writes=true`);
} finally { await browser.close(); }
