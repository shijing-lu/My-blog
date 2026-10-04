/** Run against an isolated local server using outputs/heading-fold-review/test.db. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const base = process.env.HEADING_VERIFY_BASE || 'http://127.0.0.1:43219';
assert.equal(new URL(base).hostname, '127.0.0.1', 'verification must use an isolated local server');
const output = path.resolve('outputs/heading-fold-review');
fs.mkdirSync(output, { recursive: true });
const db = new Database(path.join(output, 'test.db'), { readonly: true });
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.HEADING_VERIFY_PASSWORD || 'heading-fold-local-check' }) });
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function api(url, method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.ok, true, `${method} ${url}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}
const content = [
  'PREAMBLE', '', '[跳到三级](#level-3)', '',
  ...Array.from({ length: 6 }, (_, n) => `${'#'.repeat(n + 1)} Level ${n + 1}\n\nBODY_${n + 1}\n`),
  '## Sibling', '', 'SIBLING_BODY', '',
  '```md', '# fake heading', '```', '',
  '> ## Quote', '>', '> QUOTE_BODY', '', 'OUTSIDE_QUOTE', '',
  ':::note', 'CALLOUT_BODY', ':::', '',
  '| A | B |', '| - | - |', '| table | value |', '', '$x^2+y^2$', '',
  'Setext', '===', '', 'SETEXT_BODY', '',
].join('\n');
const home = await api('/api/articles', 'POST', {});
assert.ok(db.prepare('SELECT id FROM articles WHERE id = ?').get(home.id), 'server must write only the copied verification DB');
await api(`/api/articles/${home.id}/title`, 'PATCH', { title: '正文折叠验证' });
await api(`/api/articles/${home.id}`, 'PATCH', { content });
const article = (await api(`/api/articles/${home.id}`)).article;
const category = (await api('/api/doc/categories', 'POST', { name: '正文折叠验证' })).category;
const bundle = (await api('/api/doc/bundles', 'POST', { categoryId: category.id, name: '正文折叠验证' })).bundle;
const node = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: '正文折叠验证', content })).node;
const second = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: '切换正文验证', content: '# Second\n\nSECOND_BODY' })).node;
const deferred = (await api('/api/doc/nodes', 'POST', { bundleId: bundle.id, kind: 'article', title: '延迟正文验证', content: '# Deferred\n\n' + '延迟正文。'.repeat(20000) + '\n\n## End\n\nEND_BODY' })).node;
const report = { pages: [], editing: [], errors: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  let patchCount = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && /\/api\/(articles|doc\/nodes)\//.test(request.url())) patchCount++; });
  const reading = [
    [`/blog/${article.slug}`, 'public-article'],
    [`/edit/${home.id}`, 'home-reading'],
    [`/doc/${bundle.id}?article=${node.id}`, 'doc-reading'],
  ];
  for (const [url, name] of reading) {
    await page.goto(base + url);
    const body = page.locator('article[data-heading-folding]');
    await body.locator('.body-heading-toggle').first().waitFor();
    for (let level = 1; level <= 6; level++) assert.equal(await body.getByRole('button', { name: `折叠${level}级标题：Level ${level}`, exact: true }).count(), 1);
    assert.equal(await page.locator('main > header .body-heading-toggle').count(), 0);
    assert.equal(await body.locator('pre .body-heading-toggle').count(), 0);
    await body.getByRole('button', { name: '折叠6级标题：Level 6', exact: true }).click();
    assert.equal(await body.getByText('BODY_6', { exact: true }).isVisible(), false);
    assert.equal(await body.getByText('SIBLING_BODY', { exact: true }).isVisible(), true);
    await body.getByRole('button', { name: '展开6级标题：Level 6', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await body.getByText('BODY_6', { exact: true }).isVisible(), true);
    await body.getByRole('button', { name: '折叠2级标题：Level 2', exact: true }).click();
    await body.getByRole('button', { name: '折叠1级标题：Level 1', exact: true }).click();
    assert.equal(await body.getByText('PREAMBLE', { exact: true }).isVisible(), true);
    await body.getByRole('button', { name: '展开1级标题：Level 1', exact: true }).click();
    assert.equal(await body.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).count(), 1);
    assert.equal(await body.getByText('BODY_3', { exact: true }).isVisible(), false);
    // TOC where present; otherwise the real Markdown link in the preamble.
    const tocLink = page.locator('#doc-toc-list a[href="#level-3"]');
    if (await tocLink.count()) await tocLink.click();
    else await body.getByRole('link', { name: '跳到三级' }).click();
    assert.equal(await body.getByText('BODY_3', { exact: true }).isVisible(), true);
    // Home TOC historically scrolls without changing the hash; preserve that behavior.
    if (name !== 'home-reading') assert.equal(decodeURIComponent(new URL(page.url()).hash), '#level-3');
    await body.getByRole('button', { name: '折叠2级标题：Quote', exact: true }).click();
    assert.equal(await body.getByText('QUOTE_BODY', { exact: true }).isVisible(), false);
    assert.equal(await body.getByText('OUTSIDE_QUOTE', { exact: true }).isVisible(), true);
    await body.getByRole('button', { name: '折叠1级标题：Setext', exact: true }).click();
    assert.equal(await body.getByText('SETEXT_BODY', { exact: true }).isVisible(), false);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await body.getByText('SETEXT_BODY', { exact: true }).isVisible(), true);
    assert.equal(await body.locator('.body-heading-toggle').first().isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1366, height: 1100 });
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    report.pages.push(name);
    console.log(`READING_OK ${name}`);
  }
  // Switching within the document page and deferred rendering initialize the new body.
  await page.goto(base + `/doc/${bundle.id}?article=${node.id}`);
  await page.getByRole('button', { name: '折叠1级标题：Setext', exact: true }).click();
  await page.locator(`[data-article-switch="${second.id}"]`).click();
  await page.getByRole('button', { name: '折叠1级标题：Second', exact: true }).waitFor();
  await page.locator(`[data-article-switch="${node.id}"]`).click();
  await page.getByRole('button', { name: '展开1级标题：Setext', exact: true }).waitFor();
  assert.equal(await page.locator('article .body-heading-toggle').count(), 9);
  await page.locator(`[data-article-switch="${deferred.id}"]`).click();
  await page.getByRole('button', { name: '折叠1级标题：Deferred', exact: true }).waitFor({ timeout: 60000 });
  await page.goto(base + `/doc/${bundle.id}?article=${deferred.id}`);
  await page.getByRole('button', { name: '折叠1级标题：Deferred', exact: true }).waitFor({ timeout: 60000 });
  report.pages.push('doc-switch-and-deferred');
  console.log('DOCUMENT_SWITCH_DEFERRED_OK');

  for (const [url, name, apiUrl, value] of [
    [`/edit/${home.id}?edit=1`, 'home-editor', `/api/articles/${home.id}`, 'article'],
    [`/doc/${bundle.id}?article=${node.id}`, 'doc-editor', `/api/doc/nodes/${node.id}`, 'node'],
  ]) {
    await page.goto(base + url);
    if (name === 'doc-editor') {
      await page.waitForFunction(() => !!window.__docInlineEditor);
      await page.evaluate(() => window.__docInlineEditor.open());
    }
    const editor = page.locator('.doc-ie-view .cm-editor').first();
    await editor.locator('.cm-heading-fold-button').first().waitFor({ timeout: 60000 });
    await editor.locator(':scope > .cm-scroller > .cm-content').focus();
    await page.keyboard.press('Control+Home');
    const before = patchCount;
    const h2 = editor.getByRole('button', { name: '折叠2级标题：Level 2', exact: true });
    for (let level = 6; level >= 3; level--) {
      await page.evaluate(level => window.__docInlineEditor.jumpToHeading(level, 0), level);
      await editor.getByRole('button', { name: `折叠${level}级标题：Level ${level}`, exact: true }).click();
      const expand = editor.getByRole('button', { name: `展开${level}级标题：Level ${level}`, exact: true });
      if (level === 3) { await expand.focus(); await page.keyboard.press('Space'); }
      else await expand.click();
      await editor.getByRole('button', { name: `折叠${level}级标题：Level ${level}`, exact: true }).waitFor();
    }
    await page.evaluate(() => window.__docInlineEditor.jumpToHeading(2, 0));
    await h2.click();
    assert.equal(await editor.locator(':scope > .cm-scroller > .cm-content').innerText().then(text => text.includes('BODY_3')), false);
    await page.evaluate(() => window.__docInlineEditor.jumpToHeading(1, 0));
    await editor.getByRole('button', { name: '折叠1级标题：Level 1', exact: true }).click();
    await editor.getByRole('button', { name: '展开1级标题：Level 1', exact: true }).click();
    await editor.getByRole('button', { name: '展开2级标题：Level 2', exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 3400));
    assert.equal(patchCount, before, 'folding must not trigger autosave');
    assert.equal((await api(apiUrl))[value].content, content);
    // The editor TOC must reveal hidden target source headings.
    await page.locator('#doc-toc-list a.toc-l3').first().click();
    assert.equal(await editor.getByRole('button', { name: '折叠2级标题：Level 2', exact: true }).count(), 1);
    assert.equal(await editor.locator(':scope > .cm-scroller > .cm-content').innerText().then(text => text.includes('BODY_3')), true);
    // Fold child again, edit the visible preamble, then validate the complete saved source.
    await h2.click();
    const input = editor.locator(':scope > .cm-scroller > .cm-content');
    await input.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('EDITED_');
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await api(apiUrl))[value].content === 'EDITED_' + content) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await api(apiUrl))[value].content, 'EDITED_' + content);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.evaluate(() => window.__docInlineEditor.saveAndClose());
    await page.waitForFunction(() => document.getElementById('doc-3col')?.dataset.editing !== 'true');
    await page.waitForFunction(() => document.querySelector('article.prose')?.textContent?.includes('EDITED_PREAMBLE'));
    assert.equal(await page.locator('article .body-heading-toggle').count(), 9);
    report.editing.push(name);
    console.log(`EDITOR_AUTOSAVE_FULL_SOURCE_REFRESH_OK ${name}`);
  }
  const nestedSource = '### Outer\n\n:::note\n# NoteHeading\n\nNOTE_BODY\n:::\n\nAFTER_NOTE\n\n:::columns\n::column\n## LeftHeading\n\nLEFT_BODY\n::column\n### RightHeading\n\nRIGHT_BODY\n:::\n\nAFTER_COLUMNS\n\n### End\n\nEND_BODY';
  const nested = await api('/api/articles', 'POST', {});
  await api(`/api/articles/${nested.id}`, 'PATCH', { content: nestedSource });
  await page.goto(base + `/edit/${nested.id}?edit=1`);
  const nestedEditor = page.locator('.doc-ie-view .cm-editor').first();
  await nestedEditor.getByRole('button', { name: '折叠1级标题：NoteHeading', exact: true }).waitFor();
  const beforeNested = patchCount;
  for (const [heading, level, selector, marker] of [
    ['NoteHeading', 1, '.cm-visual-admonition', 'NOTE_BODY'],
    ['LeftHeading', 2, '.cm-column-pane:first-child', 'LEFT_BODY'],
    ['RightHeading', 3, '.cm-column-pane:last-child', 'RIGHT_BODY'],
  ]) {
    await nestedEditor.getByRole('button', { name: `折叠${level}级标题：${heading}`, exact: true }).click();
    await nestedEditor.getByRole('button', { name: `展开${level}级标题：${heading}`, exact: true }).waitFor();
    const visibleText = await page.locator(selector).innerText();
    if (visibleText.includes(marker)) {
      fs.writeFileSync(path.join(output, 'nested-fold-debug.html'), await page.locator(selector).innerHTML());
      await page.screenshot({ path: path.join(output, 'nested-fold-debug.png') });
    }
    assert.equal(visibleText.includes(marker), false, `${heading}: folded body must be hidden: ${visibleText}`);
    if (level === 1) await nestedEditor.getByRole('button', { name: `展开${level}级标题：${heading}`, exact: true }).click();
    else {
      // Existing TOC enumerates nested headings too; it must open the child editor.
      await page.locator('#doc-toc-list a').filter({ hasText: heading }).click();
      await nestedEditor.getByRole('button', { name: `折叠${level}级标题：${heading}`, exact: true }).waitFor();
    }
  }
  await nestedEditor.getByRole('button', { name: '折叠1级标题：NoteHeading', exact: true }).click();
  await page.evaluate(() => window.__docInlineEditor.jumpToHeading(3, 0));
  await nestedEditor.getByRole('button', { name: '折叠3级标题：Outer', exact: true }).click();
  await nestedEditor.getByRole('button', { name: '展开3级标题：Outer', exact: true }).click();
  await nestedEditor.getByRole('button', { name: '展开1级标题：NoteHeading', exact: true }).waitFor();
  assert.equal((await api(`/api/articles/${nested.id}`)).article.content, nestedSource);
  assert.equal(patchCount, beforeNested);
  await page.screenshot({ path: path.join(output, 'nested-editor.png') });
  report.editing.push('callout-columns-and-nested-toc');
  console.log('NESTED_WIDGET_HEADING_FOLD_SOURCE_TOC_OK');
  const large = db.prepare("SELECT id,bundle_id,length(content) AS n FROM doc_nodes WHERE kind='article' ORDER BY n DESC LIMIT 1").get();
  if (large && process.env.HEADING_VERIFY_LONG !== '0') {
    await page.goto(base + `/doc/${large.bundle_id}?article=${large.id}`, { waitUntil: 'domcontentloaded' });
    const body = page.locator('article[data-heading-folding]');
    await body.locator('.body-heading-toggle').first().waitFor({ timeout: 90000 });
    const headingCount = await body.locator('.body-heading-toggle').count();
    assert.ok(headingCount > 0);
    const before = patchCount;
    await page.waitForFunction(() => !!window.__docInlineEditor);
    await page.evaluate(() => window.__docInlineEditor.open());
    const editor = page.locator('.doc-ie-view .cm-editor').first();
    await editor.locator('.cm-heading-fold-button').first().waitFor({ timeout: 60000 });
    assert.ok(await editor.locator('.cm-lp-heading').count(), 'real long article must retain visual heading decorations');
    const arrow = editor.locator('.cm-heading-fold-button').first();
    const label = await arrow.getAttribute('aria-label');
    await arrow.click();
    await editor.getByRole('button', { name: label.replace(/^折叠/, '展开'), exact: true }).waitFor();
    assert.equal(patchCount, before);
    report.longDocument = { sourceCharacters: large.n, foldableHeadings: headingCount };
    console.log('REAL_LONG_DOCUMENT_VISUAL_EDITOR_FOLD_OK');
  }
  assert.deepEqual(report.errors, [], 'browser runtime errors');
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log('BODY_HEADING_FOLDING_VERIFIED');
} catch (error) {
  fs.writeFileSync(path.join(output, 'verification-failed.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
  db.close();
}
