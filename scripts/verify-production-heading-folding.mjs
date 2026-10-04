/** Read-only production check: display effects only; fail if any article PATCH is sent. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'https://www.byqx-blog.online';
assert.ok(process.env.PRODUCTION_ADMIN_PASSWORD, 'provide the existing production password through the process environment');
const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: process.env.PRODUCTION_ADMIN_PASSWORD }), signal: AbortSignal.timeout(20000) });
assert.equal(response.ok, true, `production login HTTP ${response.status}`);
const cookie = response.headers.get('set-cookie').split(';')[0];
const output = path.resolve('outputs/heading-fold-review');
const db = new Database(path.join(output, 'test.db'), { readonly: true });
// Use existing records from the original desktop snapshot; never create production fixtures.
const home = db.prepare("SELECT id,slug FROM articles WHERE length(content)>500 AND content LIKE '%#%' ORDER BY created_at ASC LIMIT 1").get();
const doc = db.prepare("SELECT id,bundle_id FROM doc_nodes WHERE kind='article' AND length(content)>1000 AND length(content)<90000 AND content LIKE '%#%' ORDER BY length(content) DESC LIMIT 1").get();
assert.ok(home && doc);
db.close();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { deployment: base, pages: [], errors: [], mutations: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true, secure: true }]);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  // Abort unexpected writes before they reach the server.
  await context.route('**/api/**', route => {
    const request = route.request();
    if (/^(PATCH|PUT|DELETE)$/.test(request.method())) {
      report.mutations.push(request.method() + ' ' + new URL(request.url()).pathname);
      return route.abort();
    }
    return route.continue();
  });
  for (const [url, name, edit] of [
    [`/blog/${home.slug}`, 'public-article', false],
    [`/edit/${home.id}`, 'home', true],
    [`/doc/${doc.bundle_id}?article=${doc.id}`, 'document', true],
  ]) {
    await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const body = page.locator('article[data-heading-folding]');
    const arrow = body.locator('.body-heading-toggle').first();
    await arrow.waitFor({ timeout: 90000 });
    await arrow.click();
    assert.equal(await arrow.getAttribute('aria-expanded'), 'false');
    assert.equal(await body.locator('[data-body-heading-content][hidden]').count() > 0, true);
    await arrow.click();
    if (edit) {
      await page.waitForFunction(() => !!window.__docInlineEditor);
      await page.evaluate(() => window.__docInlineEditor.open());
      const editor = page.locator('.doc-ie-view .cm-editor').first();
      const fold = editor.locator('.cm-heading-fold-button').first();
      await fold.waitFor({ timeout: 60000 });
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'false');
      await fold.click();
    }
    report.pages.push(name);
    console.log(`PRODUCTION_HEADING_FOLD_OK ${name}`);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.mutations, []);
  fs.writeFileSync(path.join(output, 'production-verification.json'), JSON.stringify(report, null, 2));
  console.log('PRODUCTION_READING_EDITOR_HEADING_FOLD_NO_WRITES_OK');
} finally {
  await browser.close();
}
