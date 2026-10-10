/** Writes are restricted to the isolated acceptance server/database, never an installed client. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:43223'; const meta=JSON.parse(fs.readFileSync('outputs/article-workspace/server.json','utf8')); assert.ok(meta.databasePath.endsWith('article-workspace'+String.fromCharCode(92)+'test.db')); assert.equal(meta.port,43223);
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-review-local' }) });
assert.equal(login.ok, true); const cookie = login.headers.get('set-cookie').split(';')[0];
async function api(url, method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { cookie, origin: base, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.ok, true, `${url}: ${await response.clone().text()}`); return response.json();
}
const source = '# Root\n\n:spoiler[独立答案甲] 与 :spoiler[独立答案乙]，重复 :spoiler[独立答案甲]。\n\n## Hidden chapter\n\n查找唯一暗藏词。\n\n:::note\n提示块内容可编辑\n:::\n\n:::columns\n::column\nLEFT_COLUMN\n::column\nRIGHT_COLUMN\n:::\n\n' + Array.from({ length: 60 }, (_, i) => `第 ${i} 段正文长文滚动验证。\n\n`).join('');
const category = (await api('/api/doc/categories', 'POST', { name: '交互验收隔离分类' })).category;
const bundle = (await api('/api/doc/bundles', 'POST', { categoryId: category.id, name: '交互验收册' })).bundle;
const first = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: '交互测试 A', content: source })).node;
const second = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: '交互测试 B', content: source })).node;
const homeCreated = await api('/api/articles', 'POST', { title: '独立编辑测试', content: source, type: 'note' });
const home = homeCreated.article ?? homeCreated;
const database = new Database('outputs/article-workspace/test.db');
try {
  const insert = database.prepare('INSERT INTO doc_nodes (id,bundle_id,parent_id,kind,title,content,sort,created_at,updated_at) VALUES (?,?,NULL,\'article\',?,?,?, ?,?)');
  database.transaction(() => { for (let i = 0; i < 80; i++) insert.run(`interaction-${bundle.id}-${i}`, bundle.id, `目录项 ${i}`, '正文', i + 2, Date.now(), Date.now()); })();
} finally { database.close(); }
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { cases: [], errors: [], fixtures: { bundle: bundle.id, first: first.id, second: second.id, home: home.id } };
fs.writeFileSync('outputs/article-workspace/reading-fixtures.json', JSON.stringify(report.fixtures));
try {
  for (const style of ['neobrutalism']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, extraHTTPHeaders: { origin: base } });
    await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
    await context.addInitScript(style => localStorage.setItem('my-blog-theme', JSON.stringify({ uiStyle: style, mode: 'light', themeId: '' })), style);
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${base}/doc/${bundle.id}?article=${first.id}`);
    const spoilers = page.locator('article .spoiler'); await spoilers.first().waitFor();
    await page.locator('[data-spoiler-toggle]').click(); await spoilers.nth(0).click(); await spoilers.nth(2).click();
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'true');
    await page.reload(); await spoilers.first().waitFor();
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'true'); assert.equal(await spoilers.nth(1).getAttribute('aria-expanded'), 'false');
    assert.equal(await spoilers.nth(2).getAttribute('aria-expanded'), 'true');
    await page.locator(`[data-article-switch="${second.id}"]`).first().click();
    await page.waitForFunction(id => document.getElementById('doc-detail-data').dataset.activeNode === id, second.id);
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'false');
    await page.locator(`[data-article-switch="${first.id}"]`).first().click();
    await page.waitForFunction(id => document.getElementById('doc-detail-data').dataset.activeNode === id, first.id);
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'true');
    await page.goBack();
    await page.waitForFunction(id => document.getElementById('doc-detail-data').dataset.activeNode === id, second.id);
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'false');
    await page.goForward();
    await page.waitForFunction(id => document.getElementById('doc-detail-data').dataset.activeNode === id, first.id);
    assert.equal(await spoilers.nth(0).getAttribute('aria-expanded'), 'true');
    report.cases.push(`${style}: spoiler identities/reload/navigation`);
    await page.keyboard.press('Control+f'); await page.locator('#article-find-query').fill('唯一暗藏词');
    await page.waitForFunction(() => document.getElementById('article-find-count').textContent === '1 / 1');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+f'); await page.locator('#article-find-query').fill('独立答案乙');
    await page.waitForFunction(() => document.querySelectorAll('article .spoiler')[1]?.classList.contains('article-find-reveal'));
    assert.equal(await spoilers.nth(1).evaluate(e => e.classList.contains('article-find-reveal')), true);
    await page.keyboard.press('Escape');
    assert.equal(await spoilers.nth(1).getAttribute('aria-expanded'), 'false');
    assert.equal(await spoilers.nth(1).evaluate(e => e.classList.contains('article-find-reveal')), false);
    const chapter = page.locator('.body-heading-toggle').filter({ hasText: '' }).nth(1);
    await chapter.click(); assert.equal(await chapter.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Control+f'); await page.locator('#article-find-query').fill('唯一暗藏词');
    await page.waitForFunction(() => document.querySelector('[data-body-heading-section="H2:hidden-chapter:0"] [data-body-heading-content]')?.hidden === false);
    await page.keyboard.press('Escape'); assert.equal(await chapter.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Control+Shift+f'); await page.locator('#article-site-query').fill('唯一暗藏词');
    await page.waitForFunction(() => document.getElementById('article-site-status').textContent.includes('共 '));
    assert.ok(await page.locator('#article-site-results a').count() >= 2);
    await page.keyboard.press('Escape');
    report.cases.push(`${style}: reading find/global search/fold restoration`);
    // The dedicated dense-directory suite covers wheel containment and both rail boundaries.
    await page.evaluate(() => window.__docInlineEditor.open());
    const input = page.locator('.doc-ie-view .cm-editor > .cm-scroller > .cm-content').first(); await input.waitFor({ timeout: 30000 });
    await input.click(); await page.keyboard.press('Control+Home'); await page.keyboard.insertText('未保存查找词\n');
    await page.keyboard.press('Control+f'); await page.locator('.cm-search input[name="search"]').first().fill('未保存查找词');
    assert.ok(await page.locator('.cm-search').count()); await page.keyboard.press('Escape');
    await input.click(); await page.keyboard.insertText('光标恢复验证');
    await page.screenshot({ path: `outputs/article-workspace/reading-${style}-editor.png` });
    report.cases.push(`${style}: editor find/typing/cursor`);
    await page.goto(`${base}/edit/${home.id}`); await page.waitForFunction(() => !!window.__docInlineEditor); await page.evaluate(() => window.__docInlineEditor.open());
    await page.locator('.doc-ie-view .cm-content').first().waitFor({ timeout: 30000 });
    await page.locator('.doc-ie-view .cm-content').first().click(); await page.keyboard.insertText('独立入口可输入');
    report.cases.push(`${style}: standalone inline editor`);
    await context.close();
  }
} finally { fs.writeFileSync('outputs/article-workspace/reading-browser.json', JSON.stringify(report, null, 2)); await browser.close(); }
assert.deepEqual(report.errors, []); console.log(`READING_INTERACTION_OK cases=${report.cases.length}`);
