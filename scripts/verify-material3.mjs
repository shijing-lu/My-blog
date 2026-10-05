/** Full route/layout coverage against an isolated database; never target production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const base = process.env.MATERIAL_VERIFY_BASE || 'http://127.0.0.1:43221';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'use an isolated local server');
const output = path.resolve('outputs/material3-review');
const consoleOnly = process.env.MATERIAL_VERIFY_CONSOLE_ONLY === '1';
const routeFilter = process.env.MATERIAL_VERIFY_ROUTE;
const reportFile = path.join(output, routeFilter ? 'coverage-targeted.json' : consoleOnly ? 'coverage-console.json' : 'coverage.json');
fs.mkdirSync(output, { recursive: true });
const db = new Database(path.join(output, 'test.db'), { readonly: true });
const article = db.prepare("SELECT id,slug,tags FROM articles WHERE encrypted=0 AND length(content)>100 AND length(content)<4000 ORDER BY length(content) DESC LIMIT 1").get();
const doc = db.prepare("SELECT id,bundle_id FROM doc_nodes WHERE kind='article' AND length(content)>100 AND length(content)<4000 ORDER BY length(content) DESC LIMIT 1").get();
const map = db.prepare('SELECT id FROM mindmaps ORDER BY article_id IS NOT NULL,length(data) LIMIT 1').get();
const moment = db.prepare("SELECT id FROM moments ORDER BY visibility='public' DESC,length(content) LIMIT 1").get();
const tagged = db.prepare("SELECT tags FROM articles WHERE encrypted=0 AND published=1 AND tags<>'[]' LIMIT 1").get();
const tag = JSON.parse(tagged?.tags || article?.tags || '["示例"]')[0];
db.close();
assert.ok(article && doc && map && moment && tag, 'the copied database must contain representative records');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const routes = walk('src/pages').filter(file => file.endsWith('.astro') && !/export const partial\s*=\s*true/.test(fs.readFileSync(file, 'utf8'))).map(file => {
  const relative = file.replaceAll('\\', '/').replace(/^src\/pages\//, '');
  let url = '/' + relative.replace(/\/index\.astro$/, '').replace(/^index\.astro$/, '').replace(/\.astro$/, '');
  url = url.replace('blog/[slug]', `blog/${article.slug}`).replace('edit/[id]', `edit/${article.id}`).replace('doc/[id]', `doc/${doc.bundle_id}?article=${doc.id}`).replace('moments/[id]', `moments/${moment.id}`).replace('admin/mindmaps/[id]', `admin/mindmaps/${map.id}`).replace('tags/[tag]', `tags/${encodeURIComponent(tag)}`).replace('schedule/[...path]', 'schedule');
  assert.ok(!url.includes('['), `unresolved route ${file}`);
  return { source: relative, url, expectedStatus: relative === '404.astro' ? 404 : 200 };
});
for (const section of ['plans', 'schedule', 'execute', 'review', 'todos', 'stats', 'settings', 'motion-lab']) routes.push({ source: `cadence/${section}`, url: `/schedule/${section}`, expectedStatus: 200 });
const selectedRoutes = routeFilter ? routes.filter(route => route.url === routeFilter) : routes;
assert.ok(selectedRoutes.length, `route not found: ${routeFilter}`);

const report = { base, startedAt: new Date().toISOString(), scope: routeFilter ? 'targeted' : consoleOnly ? 'console-only' : 'full', routeFilter, routes: selectedRoutes.length, profiles: [], pages: [], matrix: [], interactions: [], errors: [], consoleErrors: [], mutations: [], failures: [] };
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.MATERIAL_VERIFY_PASSWORD || 'material3-local-check' }), signal: AbortSignal.timeout(15000) });
assert.equal(login.ok, true, `isolated login HTTP ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const pref = (style, mode) => ({ themeId: '', uiStyle: style, mode });

async function contextFor(style, mode, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base, httpOnly: true }]);
  await context.addInitScript(({ value }) => localStorage.setItem('my-blog-theme', JSON.stringify(value)), { value: pref(style, mode) });
  await context.route('**/api/**', route => {
    const request = route.request();
    if (/^(PUT|PATCH|DELETE)$/.test(request.method())) {
      report.mutations.push({ method: request.method(), url: new URL(request.url()).pathname });
      return route.abort();
    }
    return route.continue();
  });
  // External photos/media can be slow or offline. Leave dimensions and DOM intact.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== new URL(base).origin) return route.abort();
    return route.fallback();
  });
  return context;
}

async function settle(page, style, mode) {
  await page.waitForFunction(({ style, mode }) => document.documentElement.dataset.uiStyle === style && document.documentElement.dataset.mode === mode && document.documentElement.classList.contains('dark') === (mode !== 'light'), { style, mode }, { timeout: 10000 });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))]));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (new URL(page.url()).pathname.startsWith('/schedule')) {
    await page.locator('.cadence-shell').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !/正在加载界面/.test(document.querySelector('.cadence-shell main')?.textContent || ''), { timeout: 10000 });
  }
}

async function sample(page, style, mode, width) {
  return page.evaluate(({ style, mode, width }) => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    const offending = overflow > 1 ? [...document.querySelectorAll('body *')].flatMap(element => {
      if (!(element instanceof HTMLElement)) return [];
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      if (!rect.width || !rect.height || css.visibility === 'hidden' || css.display === 'none' || (rect.right <= innerWidth + 1 && rect.left >= -1)) return [];
      return [{ tag: element.tagName.toLowerCase(), id: element.id, class: String(element.className).slice(0, 140), x: Math.round(rect.x), width: Math.round(rect.width), right: Math.round(rect.right), scrollWidth: element.scrollWidth }];
    }).slice(0, 16) : [];
    const font = getComputedStyle(document.body).fontFamily;
    return { url: location.pathname + location.search, style: root.dataset.uiStyle, mode: root.dataset.mode, dark: root.classList.contains('dark'), width: innerWidth, documentWidth: root.scrollWidth, overflow, bodyFont: font, background: getComputedStyle(document.body).backgroundColor, title: document.title, offending, validStyle: root.dataset.uiStyle === style && root.dataset.mode === mode && root.classList.contains('dark') === (mode !== 'light') && (style !== 'material3' || /Roboto/.test(font)) && innerWidth === width };
  }, { style, mode, width });
}

function fail(entry, kind, message) {
  report.failures.push({ url: entry.url, profile: entry.profile, kind, message, offending: entry.offending });
  console.log(`MATERIAL_FAILURE ${kind} ${entry.profile || ''} ${entry.url} ${message}`);
}

function captureConsole(page, profile) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const url = message.location().url;
    // Test-controlled external media aborts and the intentional 404 route are expected.
    if (/ERR_BLOCKED_BY_CLIENT/.test(text) || (url && !url.startsWith(base)) || (new URL(page.url()).pathname === '/404' && /status of 404/.test(text))) return;
    report.consoleErrors.push({ profile, page: page.url(), url, message: text });
  });
}

try {
  const profiles = consoleOnly
    ? [{ style: 'material3', mode: 'light', width: 390 }, { style: 'material3', mode: 'dark', width: 1280 }, { style: 'classic', mode: 'light', width: 1280 }]
    : ['material3', 'classic'].flatMap(style => ['light', 'dark', 'system'].flatMap(mode => [320, 390, 768, 1280, 1920].map(width => ({ style, mode, width }))));
  let nextProfile = 0;
  async function scanProfile(profile) {
    const name = `${profile.style}-${profile.mode}-${profile.width}`;
    report.profiles.push(name);
    const context = await contextFor(profile.style, profile.mode, profile.width);
    const page = await context.newPage();
    captureConsole(page, name);
    let current;
    page.on('pageerror', error => { const entry = { profile: name, url: current?.url, message: error.message }; report.errors.push(entry); });
    for (const route of selectedRoutes) {
      current = route;
      const entry = { source: route.source, url: route.url, profile: name };
      try {
        const response = await page.goto(base + route.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await settle(page, profile.style, profile.mode);
        Object.assign(entry, await sample(page, profile.style, profile.mode, profile.width), { status: response?.status(), redirected: new URL(page.url()).pathname !== new URL(base + route.url).pathname });
        if (entry.status !== route.expectedStatus && !(route.expectedStatus === 404 && entry.status === 200)) fail(entry, 'http', String(entry.status));
        if (!entry.validStyle) fail(entry, 'style', `${entry.style}/${entry.mode}/${entry.bodyFont}`);
        if (entry.overflow > 1) fail(entry, 'overflow', String(entry.overflow));
        if (new URL(page.url()).pathname === '/login' && route.url !== '/login') fail(entry, 'authentication', 'unexpected login redirect');
      } catch (error) { fail(entry, 'runtime', error.message); }
      report.pages.push(entry);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    }
    await context.close();
    console.log(`MATERIAL_ROUTE_PROFILE_DONE ${name}`);
  }
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (nextProfile < profiles.length) await scanProfile(profiles[nextProfile++]);
  }));

  if (!consoleOnly && !routeFilter) {
  const representatives = [{ name: 'home', url: '/' }, { name: 'document', url: `/doc/${doc.bundle_id}?article=${doc.id}` }, { name: 'schedule', url: '/schedule' }, { name: 'settings', url: '/admin/settings/appearance' }];
  const context = await contextFor('material3', 'light', 1280);
  const page = await context.newPage();
  captureConsole(page, 'switch-matrix');
  page.on('pageerror', error => report.errors.push({ section: 'matrix', url: page.url(), message: error.message }));
  for (const representative of representatives) {
    await page.goto(base + representative.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (const style of ['material3', 'classic']) for (const mode of ['light', 'dark', 'system']) for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: mode === 'light' ? 'light' : 'dark' });
      await page.evaluate(value => { const newValue = JSON.stringify(value); localStorage.setItem('my-blog-theme', newValue); window.dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue, storageArea: localStorage })); }, pref(style, mode));
      await settle(page, style, mode);
      const entry = { name: representative.name, profile: `${style}-${mode}-${width}`, ...await sample(page, style, mode, width) };
      report.matrix.push(entry);
      if (!entry.validStyle) fail(entry, 'style', `${entry.style}/${entry.mode}`);
      if (entry.overflow > 1) fail(entry, 'overflow', String(entry.overflow));
      if (mode === 'light' && [390, 1280].includes(width)) {
        const filename = `${representative.name}-${style}-${width}.png`;
        await page.screenshot({ path: path.join(output, filename), fullPage: false });
        entry.screenshot = filename;
      }
    }
    console.log(`MATERIAL_REPRESENTATIVE_MATRIX_DONE ${representative.name}`);
    // Full route runs use a dark system preference. Verify both live OS choices separately.
    for (const style of ['material3', 'classic']) {
      await page.evaluate(value => { const newValue = JSON.stringify(value); localStorage.setItem('my-blog-theme', newValue); window.dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue, storageArea: localStorage })); }, pref(style, 'system'));
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, colorScheme === 'dark');
        report.interactions.push({ name: `${representative.name}-${style}-system-${colorScheme}`, passed: true });
      }
    }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
  await context.close();

  const interactionContext = await contextFor('material3', 'light', 1280);
  const interactionPage = await interactionContext.newPage();
  captureConsole(interactionPage, 'interactions');
  await interactionPage.goto(base + '/schedule/todos', { waitUntil: 'domcontentloaded' });
  await settle(interactionPage, 'material3', 'light');
  try {
    const board = interactionPage.getByTestId('todo-board');
    await board.click({ position: { x: 35, y: 110 } });
    const dialog = interactionPage.getByRole('dialog', { name: '在这里记一条' });
    await dialog.waitFor({ timeout: 10000 });
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'opening moves focus inside');
    report.interactions.push({ name: 'todo-modal-opening-focus', passed: true });
    for (let i = 0; i < 8; i++) { await interactionPage.keyboard.press('Tab'); assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'focus stays trapped'); }
    report.interactions.push({ name: 'todo-modal-forward-focus-trap', passed: true });
    for (let i = 0; i < 8; i++) { await interactionPage.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'backward focus stays trapped'); }
    report.interactions.push({ name: 'todo-modal-backward-focus-trap', passed: true });
    await interactionPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    report.interactions.push({ name: 'todo-modal-focus-and-Escape', passed: true });
  } catch (error) { report.interactions.push({ name: 'todo-modal-focus-and-Escape', passed: false, message: error.message }); fail({ url: '/schedule/todos', profile: 'material3' }, 'interaction', error.message); }

  await interactionPage.goto(base + '/design/material3', { waitUntil: 'domcontentloaded' });
  await settle(interactionPage, 'material3', 'light');
  try {
    const select = interactionPage.getByRole('combobox', { name: '共享示例选择' });
    await select.click({ timeout: 10000 });
    const option = interactionPage.getByRole('option', { name: '编辑', exact: true });
    await option.waitFor();
    assert.equal(await option.locator('..').evaluate(element => getComputedStyle(element).fontFamily.includes('Roboto')), true);
    await option.click();
    assert.match(await select.innerText(), /编辑/);
    await interactionPage.getByRole('button', { name: '共享示例菜单', exact: true }).click();
    const item = interactionPage.getByRole('menuitem', { name: '示例复制' });
    await item.waitFor();
    await item.click();
    await interactionPage.getByRole('button', { name: '共享示例弹窗', exact: true }).click();
    const dialog = interactionPage.getByRole('dialog', { name: '共享组件确认' });
    await dialog.waitFor();
    await interactionPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    report.interactions.push({ name: 'shared-Radix-select-menu-dialog', passed: true });
  } catch (error) { report.interactions.push({ name: 'shared-Radix-select-menu-dialog', passed: false, message: error.message }); fail({ url: '/design/material3', profile: 'material3' }, 'interaction', error.message); }
  await interactionContext.close();
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
}
console.log(`MATERIAL_COVERAGE_RESULT routes=${report.routes} pages=${report.pages.length} matrix=${report.matrix.length} failures=${report.failures.length} errors=${report.errors.length} consoleErrors=${report.consoleErrors.length} blockedWrites=${report.mutations.length}`);
if (report.failures.length || report.errors.length || report.consoleErrors.length || report.mutations.length) process.exitCode = 1;
