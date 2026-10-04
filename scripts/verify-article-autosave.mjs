/** Exercise the installed desktop editor; only temporary test articles are modified. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'byqx-blog-desktop/config.json'), 'utf8'));
const base = `http://127.0.0.1:${config.PORT || 43217}`;
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: config.ADMIN_PASSWORD }) });
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
const ids = [];
const local = new Database(config.LOCAL_DB_PATH || path.join(process.env.APPDATA, 'byqx-blog-desktop/blog-local.db'), { readonly: true });
const count = () => local.prepare('SELECT count(*) AS n FROM articles').get().n;
async function api(url, options = {}) {
  const response = await fetch(base + url, { ...options, headers: { cookie, 'content-type': 'application/json', ...options.headers } });
  assert.equal(response.ok, true, `${options.method || 'GET'} ${url} ${response.status}`);
  return response.json();
}
async function eventually(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for saved article');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  const page = await context.newPage();
  let dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.accept(); });
  const before = count();
  await page.goto(base + '/edit');
  await page.locator('.side-toolbar a[href="/edit"]').click();
  await page.waitForURL(base + '/edit');
  await page.goto(base + '/edit/new');
  await page.waitForURL(base + '/edit');
  assert.equal(count(), before, 'opening editor and old bookmarks must not create articles');

  await page.locator('#home-create-article').click();
  await page.waitForURL(/\/edit\/(?!new)[^/?]+/);
  const first = new URL(page.url()).pathname.split('/').pop();
  ids.push(first);
  await page.waitForURL(new RegExp(`/edit/${first}`));
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  await page.locator('h1[contenteditable]').fill('自动保存验证临时文章');
  await page.locator('.cm-content[contenteditable="true"]').fill('第一段自动保存正文');
  await eventually(async () => {
    const article = (await api(`/api/articles/${first}`)).article;
    return article.title === '自动保存验证临时文章' && article.content === '第一段自动保存正文';
  });
  assert.equal(count(), before + 1, 'one explicit click creates one article');
  const article = (await api(`/api/articles/${first}`)).article;
  const publicResponse = await fetch(base + '/blog/' + article.slug);
  assert.equal(publicResponse.status, 200);
  assert.match(await publicResponse.text(), /第一段自动保存正文/);
  const prefetched = await fetch(base + '/blog/' + article.slug, { headers: { 'sec-purpose': 'prefetch' } });
  assert.match(prefetched.headers.get('cache-control'), /no-store/);
  assert.equal(await page.locator('#home-publish-status').count(), 0);
  assert.equal(await page.getByRole('button', { name: '发布', exact: true }).count(), 0);

  const second = (await api('/api/articles', { method: 'POST', body: '{}' })).id;
  ids.push(second);
  await api(`/api/articles/${second}/title`, { method: 'PATCH', body: JSON.stringify({ title: '切换验证临时文章' }) });
  await api(`/api/articles/${second}`, { method: 'PATCH', body: JSON.stringify({ content: '第二篇原文保持不变' }) });
  await page.goto(base + `/edit/${first}?edit=1`);
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  await page.locator('.cm-content[contenteditable="true"]').fill('快速切换之前的最新正文');
  await page.locator(`a[data-article-switch="${second}"]`).evaluate(link => link.click());
  await page.waitForURL(new RegExp(`/edit/${second}`));
  await eventually(async () => (await api(`/api/articles/${first}`)).article.content === '快速切换之前的最新正文');
  assert.equal((await api(`/api/articles/${second}`)).article.content, '第二篇原文保持不变');
  assert.equal(dialogs, 0, 'switching articles must not show an unsaved dialog');

  await page.goto(base + `/edit/${first}?edit=1`);
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  const offlineRoute = async route => {
    if (route.request().method() === 'PATCH') return route.abort('connectionreset');
    return route.continue();
  };
  await context.route(`**/api/articles/${first}`, offlineRoute);
  await page.locator('.cm-content[contenteditable="true"]').fill('网络恢复后也能自动续存');
  await page.waitForFunction(() => document.querySelector('.doc-ie-status')?.textContent?.includes('保存失败'));
  await page.locator(`a[data-article-switch="${second}"]`).evaluate(link => link.click());
  await page.waitForURL(new RegExp(`/edit/${second}`));
  await context.unroute(`**/api/articles/${first}`, offlineRoute);
  await eventually(async () => (await api(`/api/articles/${first}`)).article.content === '网络恢复后也能自动续存');
  assert.equal(dialogs, 0, 'failed saves must not block navigation');
  console.log('ARTICLE_ENTRY_EXPLICIT_CREATE_PUBLIC_AUTOSAVE_FAST_SWITCH_OFFLINE_RETRY_OK');
} finally {
  await browser.close();
  for (const id of ids) await api(`/api/articles/${id}`, { method: 'DELETE' });
  local.close();
}
