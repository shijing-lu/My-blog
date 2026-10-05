/** Real Chromium tab zoom (not CSS zoom, pinch scale or deviceScaleFactor). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const base = process.env.MATERIAL_VERIFY_BASE || 'http://127.0.0.1:43221';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('outputs/material3-review/repair-1.1.1');
fs.mkdirSync(output, { recursive: true });
const ext = fs.mkdtempSync(path.join(output, 'zoom-extension-'));
const profile = fs.mkdtempSync(path.join(output, 'zoom-profile-'));
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local Material zoom acceptance', version: '1.0', permissions: ['tabs'], host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'], background: { service_worker: 'background.js' } }));
fs.writeFileSync(path.join(ext, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.MATERIAL_VERIFY_PASSWORD || 'material3-local-check' }) });
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const report = { zoom: 2, method: 'chrome.tabs.setZoom/getZoom', samples: [], failures: [], errors: [], writes: [] };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
  await context.route('**/api/**', route => {
    if (/^(POST|PUT|PATCH|DELETE)$/.test(route.request().method())) { report.writes.push(new URL(route.request().url()).pathname); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  const zoom = await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: origin + '/*' });
    await chrome.tabs.setZoom(tab.id, 2);
    return chrome.tabs.getZoom(tab.id);
  }, base);
  assert.equal(zoom, 2);
  for (const style of ['material3', 'classic']) for (const mode of ['light', 'dark', 'system']) for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.emulateMedia({ colorScheme: mode === 'light' ? 'light' : 'dark' });
    await page.evaluate(value => { const newValue = JSON.stringify(value); localStorage.setItem('my-blog-theme', newValue); window.dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue, storageArea: localStorage })); }, { uiStyle: style, mode, themeId: '' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => innerWidth), width / 2);
    if (style === 'material3' && await page.locator('.side-toolbar').getAttribute('data-m3-expanded') !== 'true') await page.locator('.m3-tools-toggle').click();
    await page.locator('button[data-open-settings=""]').click();
    const sections = await page.locator('#settings-modal-nav [data-section]').evaluateAll(elements => elements.map(element => element.dataset.section));
    for (const section of sections) {
      await page.locator(`#settings-modal-nav [data-section="${section}"]`).click();
      await page.locator('#settings-modal details[data-classic-settings]').evaluateAll(elements => elements.forEach(element => { element.open = true; }));
      const geometry = await page.evaluate(() => {
        const body = document.querySelector('#settings-modal-content');
        const dialog = document.querySelector('#settings-modal');
        const close = document.querySelector('#settings-modal-close').getBoundingClientRect();
        return { cssWidth: innerWidth, dpr: devicePixelRatio, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth, dialogWidth: dialog.clientWidth, dialogScrollWidth: dialog.scrollWidth, closeVisible: close.left >= 0 && close.right <= innerWidth && close.top >= 0 && close.bottom <= innerHeight };
      });
      report.samples.push({ style, mode, viewportWidth: width, section, ...geometry });
      if (style === 'material3' && (!geometry.closeVisible || geometry.bodyScrollWidth > geometry.bodyWidth + 1 || geometry.dialogScrollWidth > geometry.dialogWidth + 1)) report.failures.push(report.samples.at(-1));
    }
    if (style === 'material3' && mode === 'light') await page.screenshot({ path: path.join(output, `zoom-200-${width}.png`) });
    await page.locator('#settings-modal-close').click();
    await page.locator('#theme-settings-btn').click();
    const device = await page.locator('#theme-settings-dialog').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    report.samples.push({ style, mode, viewportWidth: width, section: 'device', ...device });
    if (style === 'material3' && device.scrollWidth > device.width + 1) report.failures.push(report.samples.at(-1));
    await page.locator('#settings-close').click();
  }
} finally { await context.close(); fs.writeFileSync(path.join(output, 'zoom-verification.json'), JSON.stringify(report, null, 2)); }
console.log(`MATERIAL_ZOOM_RESULT samples=${report.samples.length} failures=${report.failures.length} errors=${report.errors.length} writes=${report.writes.length}`);
if (report.failures.length || report.errors.length || report.writes.length) process.exitCode = 1;
