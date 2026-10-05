/** Isolated browser checks; real cloud writes are never performed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:43221';
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'material3-local-check' }) });
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const samples = [];
try {
  for (const style of ['classic', 'material3']) for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { origin: base } });
    await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
    await context.addInitScript(style => localStorage.setItem('my-blog-theme', JSON.stringify({ uiStyle: style, mode: 'light', themeId: '' })), style);
    const page = await context.newPage();
    await page.goto(base + '/admin/settings/sync');
    await page.waitForFunction(() => document.querySelector('#sync-connection-state')?.textContent?.includes('主库：'));
    const geometry = await page.locator('#sync-connection-settings').evaluate(root => ({ width: root.clientWidth, scroll: root.scrollWidth, hasFields: !!root.querySelector('#sync-primary-url') }));
    assert.ok(geometry.hasFields); assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify({ style, width, geometry }));
    samples.push({ style, width, ...geometry });
    if (style === 'classic' && width === 320) {
      assert.equal(await page.locator('#sync-now').isDisabled(), true);
      const absent = await context.request.post(base + '/api/desktop/sync');
      assert.equal(absent.status(), 409); assert.equal((await absent.json()).running, false);
      await page.locator('#sync-primary-url').fill('https://website.invalid'); await page.locator('#sync-config-save').click();
      await page.waitForFunction(() => document.querySelector('#sync-config-feedback')?.textContent?.includes('不是 https'));
      await page.locator('#sync-primary-url').fill('postgresql://fixture:test@127.0.0.1:1/blog');
      await page.locator('#sync-fallback-url').fill('postgresql://fixture:test@127.0.0.1:2/blog'); await page.locator('#sync-config-save').click();
      await page.waitForFunction(() => document.querySelector('#sync-config-feedback')?.textContent?.includes('已保存'));
      await page.waitForFunction(() => !document.querySelector('#sync-now').disabled);
      const summary = await context.request.get(base + '/api/desktop/sync-config'); assert.deepEqual(await summary.json(), { primaryConfigured: true, fallbackConfigured: true, cloudConfigured: true });
      await page.locator('#sync-config-test').click();
      await page.waitForFunction(() => document.querySelector('#sync-config-feedback')?.textContent?.includes('连接失败'), { timeout: 15000 });
      assert.equal(await page.locator('#sync-config-test').isDisabled(), false);
      const exported = await context.request.post(base + '/api/desktop/sync-config', { data: { action: 'export', password: 'fixture-transfer' } }); const envelope = await exported.json();
      assert.ok(!JSON.stringify(envelope).includes('postgresql'));
      const bad = await context.request.post(base + '/api/desktop/sync-config', { data: { action: 'import', envelope, password: 'wrong-fixture' } }); assert.equal(bad.status(), 400);
      await page.locator('summary').filter({ hasText: '从另一台设备' }).click();
      await page.locator('#sync-transfer-text').fill(JSON.stringify(envelope)); await page.locator('#sync-transfer-password').fill('fixture-transfer'); await page.locator('#sync-config-import').click();
      await page.waitForFunction(() => document.querySelector('#sync-config-feedback')?.textContent?.includes('已导入'));
      assert.equal(await page.locator('#sync-primary-url').inputValue(), '');
      assert.ok(!await page.locator('#sync-config-feedback').textContent().then(text => text.includes('postgresql')));
    }
    await context.close();
  }
  const unauthorized = await fetch(base + '/api/desktop/sync-config'); assert.ok([401,403].includes(unauthorized.status));
  fs.writeFileSync('outputs/android-sync-browser.json', JSON.stringify({ samples, failures: 0, notes: 'Browser Android-mode simulation; no real cloud writes or physical Android device.' }, null, 2));
  console.log(`ANDROID_SYNC_BROWSER_OK samples=${samples.length}`);
} finally { await browser.close(); }
