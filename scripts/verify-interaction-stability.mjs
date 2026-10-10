/** All writes and delayed responses belong to the copied localhost acceptance database. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:43221';
const fixture = JSON.parse(fs.readFileSync('outputs/interaction-20261007-fixtures.json'));
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'material3-local-check' }) });
assert.ok(login.ok);
const cookie = login.headers.get('set-cookie').split(';')[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { cases: [], errors: [], responsive: [] };
const done = label => { report.cases.push(label); console.log(label); };
let page;
try {
  for (const style of ['classic', 'material3']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addCookies([{ name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
    await context.addInitScript(style => localStorage.setItem('my-blog-theme', JSON.stringify({ uiStyle: style, mode: 'light' })), style);
    page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    const docUrl = `${base}/doc/${fixture.bundle}?article=${fixture.first}`;
    await page.goto(docUrl); await page.waitForFunction(() => !!window.__docInlineEditor);
    // Pause a render while returning to the already visible article.
    let resume, seen = false;
    const gate = new Promise(resolve => resume = resolve);
    const pattern = `**/api/doc/nodes/${fixture.second}/render*`;
    await page.route(pattern, async route => { const response = await route.fetch(); seen = true; await gate; try { await route.fulfill({ response }); } catch {} });
    await page.locator(`[data-article-switch="${fixture.second}"]`).first().click();
    for (let i = 0; i < 100 && !seen; i++) await page.waitForTimeout(30);
    assert.ok(seen);
    await page.locator(`[data-article-switch="${fixture.first}"]`).first().click(); resume();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#doc-detail-data').getAttribute('data-active-node'), fixture.first);
    assert.equal(await page.locator('article.prose').evaluate(e => e.classList.contains('doc-article-loading')), false);
    await page.unroute(pattern); done(`${style}: delayed render superseded by visible article`);
    // Pending source fetch cannot lock another article's editor.
    let releaseSource; const sourceGate = new Promise(resolve => releaseSource = resolve);
    const sourcePattern = `**/api/doc/nodes/${fixture.first}`;
    await page.route(sourcePattern, async route => { const response = await route.fetch(); await sourceGate; try { await route.fulfill({ response }); } catch {} });
    await page.evaluate(() => window.__docInlineEditor.open());
    await page.locator(`[data-article-switch="${fixture.second}"]`).first().click();
    await page.waitForFunction(id => document.getElementById('doc-detail-data').dataset.activeNode === id, fixture.second);
    await page.evaluate(() => window.__docInlineEditor.open());
    const editorInput = page.locator('.doc-ie-view .cm-editor > .cm-scroller > .cm-content').first();
    await editorInput.waitFor(); releaseSource(); await page.unroute(sourcePattern);
    await editorInput.focus(); await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('LIFECYCLE_INPUT'); await page.keyboard.press('Control+z');
    done(`${style}: canceled source fetch/new editor/undo`);
    await page.evaluate(() => {
      window.__interactionEditor = document.querySelector('.doc-ie-view .cm-editor');
      const input = window.__interactionEditor.querySelector(':scope > .cm-scroller > .cm-content');
      window.__interactionView = input.cmTile?.root?.view || input.cmView?.rootView?.view;
    });
    const sourceBefore = await page.evaluate(() => window.__interactionView.state.doc.toString());
    const fold = page.locator('.doc-ie-view .cm-heading-fold-button').filter({ hasText: '' }).nth(1);
    await fold.click(); assert.equal(await fold.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Control+f'); await page.locator('.cm-search input[name="search"]').fill('唯一暗藏词'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.querySelector('.doc-ie-view .cm-heading-fold-button[aria-expanded="false"]'));
    await fold.click();
    await page.evaluate(() => window.__interactionView.dispatch({ effects: window.__interactionView.constructor.scrollIntoView(window.__interactionView.state.doc.toString().indexOf(':::note'), { y: 'center' }) }));
    const noteInput = page.locator('.cm-visual-admonition .cm-content').first();
    await noteInput.focus(); await page.keyboard.press('Control+f');
    await page.locator('.cm-visual-admonition .cm-search input[name="search"]').fill('内容'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.cm-visual-admonition .cm-search').count(), 0);
    await noteInput.focus(); await page.keyboard.insertText('NESTED_TEST'); await page.keyboard.press('Control+z');
    const column = page.locator('.cm-columns-widget .cm-content').first(); await column.focus(); await page.keyboard.press('Control+f');
    await page.locator('.cm-columns-widget .cm-search input[name="search"]').first().fill('LEFT_COLUMN'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.cm-columns-widget .cm-search').count(), 0);
    await column.focus(); await page.keyboard.insertText('COLUMN_TEST'); await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__interactionView.state.doc.toString()), sourceBefore);
    done(`${style}: current/nested find and fold/undo restoration`);
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(style => { const state = JSON.parse(localStorage.getItem('my-blog-theme')); state.uiStyle = style; localStorage.setItem('my-blog-theme', JSON.stringify(state)); dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue: JSON.stringify(state), storageArea: localStorage })); }, style === 'classic' ? 'material3' : 'classic');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__interactionEditor === document.querySelector('.doc-ie-view .cm-editor')), true);
      assert.equal(await page.evaluate(() => window.__interactionView.state.doc.toString()), sourceBefore);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${style} width ${width}`);
      report.responsive.push({ style, width, editorRetained: true });
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__docInlineEditor.saveAndClose());
    await page.waitForFunction(() => document.getElementById('doc-3col').dataset.editing !== 'true');
    // Native minute picker, existing event editing, 24:00 and IndexedDB reload.
    await page.goto(base + '/schedule/schedule');
    await page.getByRole('button', { name: '新建日程', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('一分钟验收');
    const start = page.getByLabel('开始', { exact: true }), end = page.getByLabel('结束', { exact: true });
    assert.equal(await start.getAttribute('type'), 'time'); assert.equal(await start.getAttribute('step'), '60');
    await start.fill('09:07'); await end.fill('09:07'); assert.equal(await page.getByRole('button', { name: '创建', exact: true }).isDisabled(), true);
    await end.fill('09:08'); await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('heading', { name: '新建日程', exact: true }).waitFor({ state: 'hidden' });
    const cell = page.getByRole('gridcell', { name: '一分钟验收 09:07–09:08', exact: true }); await cell.waitFor();
    await cell.focus(); await page.keyboard.press('Enter');
    await page.getByLabel('开始', { exact: true }).fill('09:09'); await page.getByLabel('结束', { exact: true }).fill('09:10');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('gridcell', { name: '一分钟验收 09:09–09:10', exact: true }).waitFor();
    await page.reload(); await page.getByRole('gridcell', { name: '一分钟验收 09:09–09:10', exact: true }).waitFor();
    await page.getByRole('button', { name: '新建日程', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('最后一分钟');
    await page.getByLabel('开始', { exact: true }).fill('23:59'); await page.getByLabel('结束', { exact: true }).fill('23:58');
    await page.getByLabel('当天结束 24:00').check(); assert.equal(await page.getByLabel('结束', { exact: true }).isDisabled(), true);
    await page.getByLabel('当天结束 24:00').uncheck(); assert.equal(await page.getByLabel('结束', { exact: true }).inputValue(), '23:58');
    await page.getByLabel('当天结束 24:00').check(); await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('gridcell', { name: '最后一分钟 23:59–24:00', exact: true }).waitFor();
    await page.screenshot({ path: `outputs/interaction-${style}-schedule.png` }); done(`${style}: native minute inputs/edit/24:00/reload`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: 'outputs/interaction-stability-failure.png' }); throw error; }
finally { fs.writeFileSync('outputs/interaction-20261007-stability.json', JSON.stringify(report, null, 2)); await browser.close(); }
console.log(`STABILITY_MINUTE_OK ${report.cases.length}`);
