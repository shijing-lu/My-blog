import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'byqx-blog-desktop/config.json'), 'utf8'));
const base = `http://127.0.0.1:${config.PORT || 43217}`;
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: config.ADMIN_PASSWORD }) });
if (!login.ok) throw new Error('Local login failed');
const cookie = login.headers.get('set-cookie').split(';')[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  let mode = 'transient', reads = 0, postFails = false;
  const report = { ok: true, perTable: [{ table: 'articles', pushed: 0, pulled: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 }], warnings: [] };
  await context.route('**/api/desktop/sync', async route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: postFails ? 403 : 202, json: postFails ? { error: 'session expired' } : { started: true } });
    }
    reads++;
    if (mode === 'transient' && reads === 1) return route.abort('connectionreset');
    if (mode === 'unavailable') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    return route.fulfill({ json: { running: mode === 'running', progress: { table: 'articles', index: 0, total: 35 }, cloudConfigured: true, lastError: null,
      lastReport: mode === 'partial' ? { ...report, ok: false, warnings: ['fixture failed table'] } : report } });
  });
  const page = await context.newPage();
  await page.goto(base + '/admin/settings/sync');
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent === '同步已完成');
  assert.equal(reads, 2, 'transient state request retried');
  const btn = page.locator('#sync-now');
  assert.equal(await btn.isEnabled(), true);
  mode = 'running';
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent?.startsWith('同步中：'));
  assert.equal(await btn.isDisabled(), true);
  mode = 'done';
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent === '同步已完成');
  assert.equal(await btn.isEnabled(), true);
  postFails = true;
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent?.startsWith('启动请求失败：'));
  assert.equal(await btn.isEnabled(), true, 'failed POST restores button');
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent === '同步已完成');
  postFails = false;
  mode = 'unavailable';
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent?.startsWith('无法确认同步状态：'));
  assert.equal(await btn.isEnabled(), true, 'exhausted retries restore button');
  mode = 'partial';
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent?.startsWith('同步部分完成'));
  assert.match(await page.locator('#sync-warnings').innerText(), /fixture failed table/);
  console.log('SYNC_PANEL_TRANSIENT_POST_FAILURE_RETRY_PARTIAL_OK');
} finally { await browser.close(); }
