/** Real application upload/gate UI; gallery POST responses are mocked, with no storage writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const base = process.env.MATERIAL_VERIFY_BASE || 'http://127.0.0.1:43221';
const address = new URL(base);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.port, '43221', 'use the isolated verification server only');
const output = path.resolve('outputs/material3-review');
const database = new Database(path.join(output, 'test.db'), { readonly: true });
const photoCountBefore = database.prepare('SELECT count(*) AS count FROM photos').get().count;
const login = await fetch(base + '/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.MATERIAL_VERIFY_PASSWORD || 'material3-local-check' }),
});
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function api(url, method = 'GET', body) {
  const response = await fetch(base + url, {
    method, headers: { cookie, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.ok, true, `${method} ${url}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}

const report = { gallery: [], encryptedReading: [], browserErrors: [], blockedExternalWrites: [], clipboardMethod: 'ClipboardEvent with real image files on the rendered upload page; OS clipboard untouched' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function deviceStyle(page, style) {
  const dialog = page.locator('#theme-settings-dialog');
  if (!(await dialog.evaluate(element => element.open))) await page.locator('#theme-settings-btn').click();
  await dialog.locator(`[data-ui-style-btn="${style}"]`).click();
  await page.waitForFunction(value => document.documentElement.dataset.uiStyle === value, style);
  await dialog.locator('#settings-close').click();
  await dialog.waitFor({ state: 'hidden' });
}
async function paste(page, selector, imageCount = 0, text = '') {
  return page.evaluate(async ({ selector, imageCount, text }) => {
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    for (let index = 0; index < imageCount; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 48;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = index ? '#188038' : '#1A73E8'; ctx.fillRect(0, 0, 64, 48);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      data.items.add(new File([blob], `clipboard-${index + 1}.png`, { type: 'image/png' }));
    }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector(selector).dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, imageCount, text });
}

try {
  const admin = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
  await admin.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  await admin.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).origin !== address.origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      report.blockedExternalWrites.push({ origin: new URL(request.url()).origin, method: request.method() });
      await route.abort();
    } else await route.continue();
  });
  for (const style of ['material3', 'classic']) {
    const page = await admin.newPage();
    page.on('pageerror', error => report.browserErrors.push(error.message));
    let uploadRequests = 0;
    let failSecond = true;
    const compressedPayloads = [];
    await page.route('**/api/photos', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      uploadRequests++;
      const payload = route.request().postDataJSON();
      compressedPayloads.push({ mime: payload.mime, width: payload.width, height: payload.height, originalBytes: payload.dataBase64?.length, thumbnailBytes: payload.thumbBase64?.length });
      assert.equal(payload.mime, 'image/jpeg');
      assert.equal(payload.width, 64); assert.equal(payload.height, 48);
      assert.ok(payload.dataBase64?.length > 0 && payload.thumbBase64?.length > 0, 'real canvas compression and thumbnail payload');
      await new Promise(resolve => setTimeout(resolve, 450));
      const shouldFail = failSecond && uploadRequests === 2;
      await route.fulfill({ status: shouldFail ? 500 : 200, contentType: 'application/json', body: JSON.stringify(shouldFail ? { error: '模拟图片上传失败' } : { photo: { id: `mock-${style}-${uploadRequests}` } }) });
    });
    // The repository's upload/management page is /gallery/upload (no /admin/gallery route).
    await page.goto(base + '/gallery/upload');
    await deviceStyle(page, style);
    const zone = page.locator('#drop-zone');
    await zone.waitFor();
    await page.mouse.move(0, 0);
    await zone.focus();
    assert.equal(await paste(page, '#drop-zone', 2), true, 'focused picker accepts multiple clipboard images');
    assert.equal(await page.locator('#upload-list > div').count(), 2);
    await page.locator('#upload-status').getByText('已添加 2 张照片，点击「开始上传」', { exact: true }).waitFor();
    const pendingFiles = await page.locator('#upload-list').innerText();
    await page.evaluate(() => { window.__materialQueuedPhotoRow = document.querySelector('#upload-list > div'); });
    await deviceStyle(page, style === 'material3' ? 'classic' : 'material3');
    assert.equal(await page.locator('#upload-list').innerText(), pendingFiles, 'switching style preserves pending clipboard files');
    assert.equal(await page.evaluate(() => window.__materialQueuedPhotoRow === document.querySelector('#upload-list > div')), true, 'style switch does not reconstruct upload rows');
    await deviceStyle(page, style);
    await page.locator('#upload-btn').click();
    await page.locator('#upload-status').getByText('上传中…', { exact: true }).waitFor();
    assert.equal(await page.locator('#upload-btn').isDisabled(), true);
    await page.screenshot({ path: path.join(output, `gallery-${style}-upload-progress.png`) });
    await page.locator('#upload-status').getByText('完成 1 张，失败 1 张（可重新选择重试）', { exact: true }).waitFor();
    assert.equal(await page.locator('#upload-list > div').count(), 1, 'success removed, failed item remains for retry');
    assert.equal(await page.locator('#upload-btn').innerText(), '重试剩余（1 张）');
    await page.screenshot({ path: path.join(output, `gallery-${style}-upload-error.png`) });
    failSecond = false;
    await page.locator('#upload-btn').click();
    await page.locator('#upload-status').getByText('完成 1 张', { exact: true }).waitFor();
    assert.equal(await page.locator('#upload-list > div').count(), 0);

    await page.evaluate(() => document.activeElement?.blur());
    await zone.hover();
    assert.equal(await page.evaluate(() => document.activeElement !== document.getElementById('drop-zone')), true);
    assert.equal(await paste(page, 'body', 2), true, 'hovering without picker focus accepts multiple clipboard images');
    assert.equal(await page.locator('#upload-list > div').count(), 2);
    await page.locator('#upload-btn').click();
    await page.locator('#upload-status').getByText('完成 2 张', { exact: true }).waitFor();
    assert.equal(uploadRequests, 5);
    assert.equal(await page.locator('#upload-list > div').count(), 0);

    await page.locator('#upload-title').fill('普通文本输入保留');
    await page.locator('#upload-title').focus();
    await zone.hover();
    assert.equal(await paste(page, '#upload-title', 2, 'ordinary clipboard text'), false, 'text fields keep their paste event even when picker is hovered');
    assert.equal(await page.locator('#upload-title').inputValue(), '普通文本输入保留');
    assert.equal(await page.locator('#upload-list > div').count(), 0);
    await zone.focus();
    assert.equal(await paste(page, '#drop-zone', 0, 'text only'), false, 'text-only clipboard is not swallowed');
    await page.locator('#upload-status').getByText('未发现图片，请先复制图片或截图，再在此处粘贴', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `gallery-${style}-paste.png`) });
    report.gallery.push({ style, focusedMultipleImages: true, hoveredMultipleImages: true, pendingQueuePreservedOnSwitch: true, textFieldsKeepPaste: true, textOnlyKeepPaste: true, progressVisible: true, failureSummaryVisible: true, retryWorks: true, mockedUploadRequests: uploadRequests, compressedPayloads });
    console.log(`MATERIAL_GALLERY_ACTUAL_PAGE_PASTE_UPLOAD_MOCK_OK ${style}`);
    await page.close();
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM photos').get().count, photoCountBefore, 'mocked gallery upload cannot create database/object-store photos');

  const fixture = await api('/api/articles', 'POST', {});
  assert.ok(database.prepare('SELECT id FROM articles WHERE id = ?').get(fixture.id), 'encrypted fixture must be in the copied test database');
  const secretSource = '# Protected heading\n\nSECRET_MATERIAL_BODY\n\n## Protected subheading\n\nSECRET_MATERIAL_SUB_BODY';
  await api(`/api/articles/${fixture.id}/title`, 'PATCH', { title: 'Material 加密阅读回归' });
  await api(`/api/articles/${fixture.id}`, 'PATCH', { content: secretSource });
  await api(`/api/articles/${fixture.id}/metadata`, 'PATCH', { encrypted: true, encryptPassword: 'material-fixture-only', encryptHint: '隔离测试文章' });
  const article = (await api(`/api/articles/${fixture.id}`)).article;
  report.encryptedFixture = { article: fixture.id };
  for (const style of ['material3', 'classic']) {
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await visitor.newPage();
    page.on('pageerror', error => report.browserErrors.push(error.message));
    const response = await page.goto(base + `/blog/${article.slug}`);
    assert.equal((await response.text()).includes('SECRET_MATERIAL_BODY'), false, 'locked source must be absent from server HTML');
    await deviceStyle(page, style);
    await page.locator('#article-gate-form').waitFor();
    assert.equal(await page.locator('article[data-heading-folding]').count(), 0);
    await page.locator('#article-gate-password').fill('incorrect-fixture-password');
    await page.locator('#article-gate-submit').click();
    await page.locator('#article-gate-status').getByText('密码错误', { exact: true }).waitFor();
    assert.equal(await page.locator('#article-gate-password').isVisible(), true);
    await page.screenshot({ path: path.join(output, `encrypted-${style}-incorrect-password.png`) });
    await page.locator('#article-gate-password').fill('material-fixture-only');
    await page.locator('#article-gate-submit').click();
    const body = page.locator('article[data-heading-folding]');
    await body.getByText('SECRET_MATERIAL_BODY', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('html').getAttribute('data-ui-style'), style, 'unlock reload preserves device appearance');
    await body.getByRole('button', { name: '折叠1级标题：Protected heading', exact: true }).click();
    assert.equal(await body.getByText('SECRET_MATERIAL_BODY', { exact: true }).isVisible(), false);
    await body.getByRole('button', { name: '展开1级标题：Protected heading', exact: true }).click();
    assert.equal(await body.getByText('SECRET_MATERIAL_BODY', { exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'encrypted reading has no page overflow at 390');
    await page.screenshot({ path: path.join(output, `encrypted-${style}-unlocked.png`) });
    report.encryptedReading.push({ style, lockedSourceAbsent: true, wrongPasswordVisible: true, correctPasswordUnlocks: true, appearancePreservedAfterReload: true, headingFoldingWorks: true, mobileNoOverflow: true });
    console.log(`MATERIAL_ENCRYPTED_READING_UNLOCK_FOLD_OK ${style}`);
    await visitor.close();
  }
  assert.equal((await api(`/api/articles/${fixture.id}`)).article.content, secretSource);
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.blockedExternalWrites, []);
  fs.writeFileSync(path.join(output, 'media-gate-verification.json'), JSON.stringify(report, null, 2));
  console.log('MATERIAL3_GALLERY_PASTE_ENCRYPTED_READING_VERIFIED');
} catch (error) {
  const latestPage = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (latestPage) await latestPage.screenshot({ path: path.join(output, 'media-gate-failed.png') });
  fs.writeFileSync(path.join(output, 'media-gate-verification-failed.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
  database.close();
}
