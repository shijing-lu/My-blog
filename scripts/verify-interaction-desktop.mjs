/** Runs the built Windows desktop main process with a copied DB and isolated profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { _electron as electron } from 'playwright-core';
const root = process.cwd(), output = path.join(root, 'outputs/interaction-desktop');
const fixture = JSON.parse(fs.readFileSync('outputs/interaction-20261007-fixtures.json'));
const payload = path.join(root, 'release/win-unpacked/resources/app');
assert.equal(JSON.parse(fs.readFileSync(path.join(payload, 'package.json'))).version, '1.1.3');
fs.mkdirSync(output, { recursive: true });
const source = new Database('outputs/material3-review/test.db', { readonly: true });
try { await source.backup(path.join(output, 'test.db')); } finally { source.close(); }
const appData = path.join(output, 'appdata'), profile = path.join(output, 'profile'), wrapper = path.join(output, 'wrapper');
fs.mkdirSync(path.join(appData, 'byqx-blog-desktop'), { recursive: true }); fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(wrapper, { recursive: true });
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({ LOCAL_DB_PATH: path.join(output, 'test.db'), ADMIN_PASSWORD: 'interaction-local-only', SYNC_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/isolated', PORT: '43223' }));
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({ name: 'interaction-desktop-acceptance', version: '1.1.3', main: 'main.cjs' }));
fs.writeFileSync(path.join(wrapper, 'main.cjs'), `const {app}=require('electron'); app.setPath('appData',${JSON.stringify(appData)}); app.setPath('userData',${JSON.stringify(profile)}); require(${JSON.stringify(path.join(payload, 'desktop/main.cjs'))});`);
const env = { ...process.env, BYQX_START_PATH: `/doc/${fixture.bundle}?article=${fixture.first}`, DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [wrapper], env, timeout: 60000 });
const report = { version: '1.1.3', actualDesktopMain: true, isolatedDatabase: true, cases: [], errors: [] };
let app = await launch();
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('appData')), appData);
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.1.3');
  const page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:43223/doc/**', { timeout: 60000 });
  assert.match(await page.evaluate(() => navigator.userAgent), /Electron\//);
  await page.evaluate(async () => { const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'interaction-local-only' }) }); if (!res.ok) throw Error('isolated login failed'); });
  await page.reload(); await page.waitForFunction(() => !!window.__docInlineEditor);
  await page.locator('[data-spoiler-toggle]').waitFor();
  if (await page.locator('html').getAttribute('data-spoiler-hide') !== 'on') await page.locator('[data-spoiler-toggle]').click();
  const spoiler = page.locator('article .spoiler').first();
  if (await spoiler.getAttribute('aria-expanded') !== 'true') await spoiler.click();
  await page.evaluate(() => window.__docInlineEditor.open());
  const input = page.locator('.doc-ie-view .cm-editor > .cm-scroller > .cm-content').first(); await input.waitFor();
  await input.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.insertText('DESKTOP_UNSAVED_FIND\n');
  await page.evaluate(() => { window.__acceptanceEditor = document.querySelector('.doc-ie-view .cm-editor'); });
  for (const style of ['material3', 'classic']) {
    await page.evaluate(style => { const state = JSON.parse(localStorage.getItem('my-blog-theme') || '{}'); state.uiStyle = style; localStorage.setItem('my-blog-theme', JSON.stringify(state)); dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue: JSON.stringify(state), storageArea: localStorage })); }, style);
    await page.waitForFunction(style => document.documentElement.dataset.uiStyle === style, style);
    assert.equal(await page.evaluate(() => window.__acceptanceEditor === document.querySelector('.doc-ie-view .cm-editor')), true);
    await input.focus(); await page.keyboard.press('Control+f'); await page.locator('.cm-search input[name="search"]').first().fill('DESKTOP_UNSAVED_FIND'); await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(output, `${style}.png`) }); report.cases.push(`${style}: actual Electron editor/find/theme identity`);
  }
  await input.focus(); await page.keyboard.press('Control+z');
  await page.evaluate(() => window.__docInlineEditor.saveAndClose());
  await page.waitForFunction(() => document.getElementById('doc-3col').dataset.editing !== 'true');
  await app.close(); app = await launch();
  const reopened = await app.firstWindow(); await reopened.waitForURL('http://127.0.0.1:43223/doc/**', { timeout: 60000 });
  await reopened.locator('article .spoiler').first().waitFor();
  assert.equal(await reopened.locator('html').getAttribute('data-spoiler-hide'), 'on');
  assert.equal(await reopened.locator('article .spoiler').first().getAttribute('aria-expanded'), 'true');
  report.cases.push('desktop restart: spoiler preference and per-item state restored');
  assert.deepEqual(report.errors, []); console.log('REAL_DESKTOP_INTERACTION_1_1_3_OK');
} finally { fs.writeFileSync('outputs/interaction-20261007-desktop.json', JSON.stringify(report, null, 2)); await app.close().catch(() => {}); }
