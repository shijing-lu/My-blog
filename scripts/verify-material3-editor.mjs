/** Functional checks run only against the dedicated, copied Material verification database. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const base = process.env.MATERIAL_VERIFY_BASE || 'http://127.0.0.1:43221';
const target = new URL(base);
assert.equal(target.hostname, '127.0.0.1', 'only the isolated localhost server is allowed');
assert.equal(target.port, '43221', 'refuse to write to the installed client or another server');
const output = path.resolve('outputs/material3-review');
const databasePath = path.join(output, 'test.db');
assert.ok(fs.existsSync(databasePath), 'root must prepare the isolated database before running this script');
const database = new Database(databasePath, { readonly: true });
const login = await fetch(base + '/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.MATERIAL_VERIFY_PASSWORD || 'material3-local-check' }),
});
assert.equal(login.ok, true, 'isolated test login');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);

async function api(url, method = 'GET', body) {
  const response = await fetch(base + url, {
    method, headers: { cookie, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.ok, true, `${method} ${url}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}

const fixtureSource = [
  'PREAMBLE_FOR_MATERIAL_SWITCH', '', '[阅读跳转](#level-3)', '',
  ...Array.from({ length: 6 }, (_, index) => [
    `${'#'.repeat(index + 1)} Level ${index + 1}`, '', `BODY_${index + 1}`, '',
    ...Array.from({ length: 12 }, (_, row) => `正文段落 ${index + 1}-${row + 1}：保留完整内容，换肤不能改变自动保存或标题折叠。`.repeat(3)), '',
  ].join('\n')),
  ':::note', '## Embedded note', '', 'CALLOUT_BODY', ':::', '',
  ':::columns', '::column', '### Left column', '', 'LEFT_BODY', '::column',
  '#### Right column', '', 'RIGHT_BODY', ':::', '',
  '```typescript', 'const heading = "# this is code, not a heading";', '```', '',
  '$$ E = mc^2 $$', '', '| Key | Value |', '| --- | --- |', '| source | intact |', '',
  '## Sibling', '', 'SIBLING_BODY', '',
].join('\n');

const report = { fixtures: {}, reading: [], editing: [], settings: [], state: [], errors: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let requestsToSave = 0;

async function poll(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(label);
}

async function setDeviceStyle(page, style, close = true) {
  const dialog = page.locator('#theme-settings-dialog');
  if (!(await dialog.evaluate(element => element.open))) await page.locator('#theme-settings-btn').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator(`[data-ui-style-btn="${style}"]`).click();
  const resolved = style === 'inherit' ? await page.locator('html').getAttribute('data-site-ui-style') : style;
  await page.waitForFunction(expected => document.documentElement.dataset.uiStyle === expected, resolved);
  assert.equal(await dialog.evaluate(element => element.open), true, 'changing style must keep the current dialog open');
  assert.equal(await dialog.locator(`[data-ui-style-btn="${style}"]`).getAttribute('aria-pressed'), 'true');
  await poll(async () => (await dialog.locator('[data-classic-appearance-controls]').isVisible()) === ((await page.locator('html').getAttribute('data-ui-style')) === 'classic'), 'appearance controls must follow the current resolved style');
  if (close) {
    await dialog.locator('#settings-close').click();
    await dialog.waitFor({ state: 'hidden' });
  }
}

async function editorSnapshot(page) {
  return page.evaluate(() => {
    const element = document.querySelector('.doc-ie-view .cm-editor');
    const content = element?.querySelector(':scope > .cm-scroller > .cm-content');
    // The equivalent of CodeMirror's EditorView.findFromDOM, without importing a second editor bundle.
    const view = content?.cmTile?.root?.view || content?.cmView?.rootView?.view;
    if (!view) throw Error('cannot locate the active CodeMirror view');
    return { source: view.state.doc.toString(), anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
  });
}

async function assertSameEditor(page, snapshot) {
  assert.equal(await page.evaluate(() => window.__materialEditorNode === document.querySelector('.doc-ie-view .cm-editor')), true, 'style switching must preserve editor DOM identity');
  assert.equal(await page.evaluate(() => {
    const content = document.querySelector('.doc-ie-view .cm-editor > .cm-scroller > .cm-content');
    const view = content?.cmTile?.root?.view || content?.cmView?.rootView?.view;
    return view === window.__materialEditorView;
  }), true, 'style switching must preserve the actual EditorView');
  assert.deepEqual(await editorSnapshot(page), snapshot, 'caret, selection and full Markdown source must remain unchanged');
}

try {
  await api('/api/ui-style', 'PUT', { defaultStyle: 'classic' });
  const home = await api('/api/articles', 'POST', {});
  assert.ok(database.prepare('SELECT id FROM articles WHERE id = ?').get(home.id), 'server writes must reach the copied verification database');
  await api(`/api/articles/${home.id}/title`, 'PATCH', { title: 'Material 界面与编辑回归' });
  await api(`/api/articles/${home.id}`, 'PATCH', { content: fixtureSource });
  const article = (await api(`/api/articles/${home.id}`)).article;
  const category = (await api('/api/doc/categories', 'POST', { name: 'Material 界面回归' })).category;
  const bundle = (await api('/api/doc/bundles', 'POST', { categoryId: category.id, name: 'Material 界面回归' })).bundle;
  const node = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: 'Material 界面与编辑回归', content: fixtureSource })).node;
  assert.ok(database.prepare('SELECT id FROM doc_nodes WHERE id = ?').get(node.id));
  report.fixtures = { article: home.id, bundle: bundle.id, node: node.id, sourceCharacters: fixtureSource.length, isolatedDatabase: databasePath };

  const context = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (request.method() === 'PATCH' && /\/api\/(articles|doc\/nodes)\//.test(request.url())) requestsToSave++; });

  for (const [url, name] of [
    [`/blog/${article.slug}`, 'public-article'], [`/edit/${home.id}`, 'home-reading'], [`/doc/${bundle.id}?article=${node.id}`, 'doc-reading'],
  ]) {
    await page.goto(base + url);
    const body = page.locator('article[data-heading-folding]');
    await body.getByRole('button', { name: '折叠2级标题：Level 2', exact: true }).waitFor({ timeout: 60000 });
    await body.getByRole('button', { name: '折叠2级标题：Level 2', exact: true }).click();
    const before = requestsToSave;
    for (const style of ['material3', 'classic', 'material3']) {
      await setDeviceStyle(page, style);
      await body.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).waitFor();
      assert.equal(await body.getByText('BODY_3', { exact: true }).isVisible(), false);
      assert.equal(await body.getByText('SIBLING_BODY', { exact: true }).isVisible(), true);
    }
    assert.equal(requestsToSave, before, 'reading/folding/style switches must not save article source');
    await page.screenshot({ path: path.join(output, `functional-${name}-material3.png`) });
    report.reading.push(name);
    console.log(`MATERIAL_READING_FOLD_STYLE_OK ${name}`);
  }

  for (const [url, name, apiUrl, entity] of [
    [`/edit/${home.id}?edit=1`, 'home-editor', `/api/articles/${home.id}`, 'article'],
    [`/doc/${bundle.id}?article=${node.id}`, 'doc-editor', `/api/doc/nodes/${node.id}`, 'node'],
  ]) {
    await page.goto(base + url);
    await page.waitForFunction(() => !!window.__docInlineEditor);
    if (name === 'doc-editor') await page.evaluate(() => window.__docInlineEditor.open());
    const editor = page.locator('.doc-ie-view .cm-editor').first();
    await editor.locator('.cm-heading-fold-button').first().waitFor({ timeout: 60000 });
    const input = editor.locator(':scope > .cm-scroller > .cm-content');
    await input.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.__docInlineEditor.jumpToHeading(2, 0));
    await editor.getByRole('button', { name: '折叠2级标题：Level 2', exact: true }).click();
    await input.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {
      window.__materialEditorNode = document.querySelector('.doc-ie-view .cm-editor');
      const content = window.__materialEditorNode.querySelector(':scope > .cm-scroller > .cm-content');
      window.__materialEditorView = content.cmTile?.root?.view || content.cmView?.rootView?.view;
    });
    const snapshot = await editorSnapshot(page);
    assert.equal(snapshot.source, fixtureSource);
    const before = requestsToSave;
    for (const style of ['classic', 'material3', 'classic', 'material3']) {
      await setDeviceStyle(page, style);
      await assertSameEditor(page, snapshot);
      await editor.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).waitFor();
    }
    assert.equal(requestsToSave, before, 'style switches cannot trigger an article autosave');
    await input.focus();
    await page.keyboard.type('M3_EDITED_');
    const changed = fixtureSource.slice(0, snapshot.head) + 'M3_EDITED_' + fixtureSource.slice(snapshot.head);
    await poll(async () => (await api(apiUrl))[entity].content === changed, `${name}: full source autosaves after switching`, 20000);
    const editedSnapshot = await editorSnapshot(page);
    await setDeviceStyle(page, 'classic');
    await assertSameEditor(page, editedSnapshot);
    await input.focus();
    await page.keyboard.press('Control+z');
    assert.equal((await editorSnapshot(page)).source, fixtureSource, `${name}: undo history must survive style changes`);
    await poll(async () => (await api(apiUrl))[entity].content === fixtureSource, `${name}: undo autosaves complete source`, 20000);
    await editor.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).waitFor();
    await setDeviceStyle(page, 'material3');
    await page.screenshot({ path: path.join(output, `functional-${name}-material3.png`) });
    const responsiveSnapshot = await editorSnapshot(page);
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1100 });
      await poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow at ${width}`);
      await assertSameEditor(page, responsiveSnapshot);
      // At narrow widths long H1 text moves H2 outside the virtual editor viewport.
      // Scroll to its retained source position without selecting or unfolding it.
      await page.evaluate(() => {
        const view = window.__materialEditorView;
        const headingPosition = view.state.doc.toString().indexOf('## Level 2');
        view.dispatch({ effects: view.constructor.scrollIntoView(headingPosition, { y: 'center' }) });
      });
      await editor.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).waitFor();
      if (width === 390) await page.screenshot({ path: path.join(output, `functional-${name}-material3-390.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 1100 });
    await page.evaluate(() => window.__docInlineEditor.saveAndClose());
    await page.waitForFunction(() => document.getElementById('doc-3col')?.dataset.editing !== 'true');
    assert.equal((await api(apiUrl))[entity].content, fixtureSource);
    report.editing.push({ page: name, caretPreserved: true, editorIdentityPreserved: true, foldsPreserved: true, undoPreserved: true, fullSourceAutosaved: true, noOverflowWidths: [320, 390, 768, 1280, 1920] });
    console.log(`MATERIAL_EDITOR_IDENTITY_CARET_FOLD_UNDO_AUTOSAVE_OK ${name}`);
  }

  await page.goto(base + '/admin/settings/appearance');
  await setDeviceStyle(page, 'inherit');
  const settings = page.locator('[data-ui-style-settings]');
  await settings.waitFor();
  await page.route('**/api/ui-style', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟保存失败' }) });
    else await route.continue();
  });
  await settings.locator('input[value="material3"]').check();
  await settings.locator('[data-ui-style-save]').click();
  await settings.getByText('模拟保存失败', { exact: true }).waitFor();
  assert.equal(await settings.locator('input[value="classic"]').isChecked(), true, 'failed save restores original choice');
  assert.equal(await page.locator('html').getAttribute('data-ui-style'), 'classic', 'failed save keeps active style');
  assert.equal((await api('/api/ui-style')).defaultStyle, 'classic');
  await page.unroute('**/api/ui-style');
  await settings.locator('input[value="material3"]').check();
  await settings.locator('[data-ui-style-save]').click();
  await page.waitForFunction(() => document.documentElement.dataset.uiStyle === 'material3');
  assert.equal((await api('/api/ui-style')).defaultStyle, 'material3');
  await settings.getByText('已保存。跟随站点的设备已应用新风格。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'functional-site-default-material3.png') });
  report.settings.push('failure-rollback', 'successful-default-material3');
  console.log('MATERIAL_SITE_DEFAULT_SAVE_ROLLBACK_OK');

  const visitors = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
  const visitor = await visitors.newPage();
  const initialResponse = await visitor.goto(base + '/');
  assert.match(await initialResponse.text(), /data-site-ui-style="material3"/);
  assert.match(await initialResponse.text(), /data-ui-style="material3"/);
  await visitor.waitForFunction(() => document.documentElement.dataset.uiStyle === 'material3');
  report.settings.push('visitor-SSR-first-frame-material3');
  await setDeviceStyle(visitor, 'classic');
  await visitor.reload();
  await visitor.waitForFunction(() => document.documentElement.dataset.uiStyle === 'classic');
  assert.equal(await visitor.locator('html').getAttribute('data-site-ui-style'), 'material3');
  report.settings.push('explicit-device-classic-wins-after-refresh');

  const sibling = await visitors.newPage();
  await sibling.goto(base + '/');
  await sibling.waitForFunction(() => document.documentElement.dataset.uiStyle === 'classic');
  await setDeviceStyle(visitor, 'material3');
  await sibling.waitForFunction(() => document.documentElement.dataset.uiStyle === 'material3');
  await visitor.locator('#theme-settings-btn').click();
  await visitor.locator('[data-mode-btn="system"]').click();
  await visitor.locator('#settings-close').click();
  await visitor.emulateMedia({ colorScheme: 'dark' });
  await visitor.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await visitor.emulateMedia({ colorScheme: 'light' });
  await visitor.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  report.state.push('cross-tab-device-storage-event', 'system-dark-light-live');

  await setDeviceStyle(visitor, 'inherit');
  await api('/api/ui-style', 'PUT', { defaultStyle: 'classic' });
  await sibling.bringToFront();
  await visitor.bringToFront();
  // Headless focus delivery varies; dispatch the same window event as a real focus.
  await visitor.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visitor.waitForFunction(() => document.documentElement.dataset.uiStyle === 'classic');
  report.state.push('window-focus-refreshes-site-default');

  await setDeviceStyle(visitor, 'material3');
  await visitor.evaluate(() => {
    for (const id of ['site-custom-css-live', 'sitecss-preview-style', 'mdcss-preview-style', 'font-face-test']) {
      const style = document.createElement('style'); style.id = id;
      style.textContent = 'html { --test-legacy-preview: injected; }'; document.head.appendChild(style);
    }
  });
  await visitor.waitForFunction(() => ['site-custom-css-live', 'sitecss-preview-style', 'mdcss-preview-style', 'font-face-test'].every(id => document.getElementById(id)?.media === 'not all'));
  await setDeviceStyle(visitor, 'classic');
  assert.equal(await visitor.evaluate(() => ['site-custom-css-live', 'sitecss-preview-style', 'mdcss-preview-style', 'font-face-test'].every(id => document.getElementById(id)?.media === 'all')), true);
  report.state.push('dynamic-custom-CSS-gated-and-restored');
  assert.deepEqual(report.errors, [], 'editor/settings browser runtime errors');
  fs.writeFileSync(path.join(output, 'editor-verification.json'), JSON.stringify(report, null, 2));
  console.log('MATERIAL3_FUNCTIONAL_EDITOR_SETTINGS_VERIFIED');
} catch (error) {
  const latestPage = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (latestPage) {
    await latestPage.screenshot({ path: path.join(output, 'functional-failed.png') });
    report.failureState = await latestPage.evaluate(() => {
      const dialog = document.querySelector('#theme-settings-dialog');
      const controls = dialog?.querySelector('[data-classic-appearance-controls]');
      return { url: location.pathname, style: document.documentElement.dataset.uiStyle, siteStyle: document.documentElement.dataset.siteUiStyle,
        dialogOpen: dialog?.open, dialogDisplay: dialog ? getComputedStyle(dialog).display : null,
        controlsHidden: controls?.hidden, controlsDisplay: controls ? getComputedStyle(controls).display : null,
        controlsRect: controls?.getBoundingClientRect().toJSON() };
    });
  }
  fs.writeFileSync(path.join(output, 'editor-verification-failed.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2));
  throw error;
} finally {
  try { await api('/api/ui-style', 'PUT', { defaultStyle: 'classic' }); } catch { /* Include failures in the caller's diagnostics. */ }
  await browser.close();
  database.close();
}
