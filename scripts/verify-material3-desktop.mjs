/** Exercise the installed Electron window; restore the user's device preference afterward. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const output = path.resolve('outputs/material3-review');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9347');
const context = browser.contexts()[0];
const page = context.pages().find(page => /^http:\/\/127\.0\.0\.1:/.test(page.url()));
assert.ok(page, 'installed desktop window must be running');
await page.locator('#theme-settings-btn').waitFor({ timeout: 60000 });
const original = await page.evaluate(() => localStorage.getItem('my-blog-theme'));
const report = { userAgent: await page.evaluate(() => navigator.userAgent), styles: [], errors: [], writes: [] };
assert.match(report.userAgent, /Electron\//);
const blocked = async route => {
  if (/^(POST|PUT|PATCH|DELETE)$/.test(route.request().method())) {
    report.writes.push(new URL(route.request().url()).pathname);
    return route.abort();
  }
  return route.continue();
};
page.on('pageerror', error => report.errors.push(error.message));
await context.route('**/api/**', blocked);
try {
  const dialog = page.locator('#theme-settings-dialog');
  for (const style of ['material3', 'classic']) {
    if (!(await dialog.evaluate(element => element.open))) await page.locator('#theme-settings-btn').click();
    await dialog.locator(`[data-ui-style-btn="${style}"]`).click();
    await page.waitForFunction(expected => document.documentElement.dataset.uiStyle === expected, style);
    assert.equal(await dialog.evaluate(element => element.open), true);
    await dialog.locator('#settings-close').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => ({
      style: document.documentElement.dataset.uiStyle,
      font: getComputedStyle(document.body).fontFamily,
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(result.documentWidth <= result.width + 1);
    if (style === 'material3') assert.match(result.font, /Roboto/);
    result.screenshot = `desktop-installed-${style}.png`;
    await page.screenshot({ path: path.join(output, result.screenshot), fullPage: false });
    report.styles.push(result);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.writes, []);
  console.log('MATERIAL_REAL_ELECTRON_STYLES_OK');
} finally {
  await page.evaluate(raw => {
    if (raw === null) localStorage.removeItem('my-blog-theme');
    else localStorage.setItem('my-blog-theme', raw);
    window.dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue: raw, storageArea: localStorage }));
  }, original);
  report.preferenceRestored = await page.evaluate(raw => localStorage.getItem('my-blog-theme') === raw, original);
  await context.unroute('**/api/**', blocked);
  fs.writeFileSync(path.join(output, 'desktop-verification.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
