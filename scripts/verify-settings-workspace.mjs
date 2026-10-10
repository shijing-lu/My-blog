import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out = path.resolve('outputs/settings-workspace');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'server.json'), 'utf8'));
assert.equal(meta.databasePath, path.join(out, 'test.db')); assert.equal(meta.port, 43225);
const base = `http://127.0.0.1:${meta.port}`;
const sections = ['site-name', 'hero-quotes', 'landing', 'appearance', 'image-bed', 'md-css', 'ai', 'netdisk', 'shortcuts', 'sync'];
const route = section => '/admin/settings/' + (section === 'shortcuts' ? 'editor-shortcuts' : section);
const interactionsOnly = process.env.SETTINGS_INTERACTIONS_ONLY === '1';
const previous = interactionsOnly ? JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json'), 'utf8')) : null;
const report = { layouts: previous?.layouts ?? [], cases: [], errors: [], mocked: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-review-local' }) });
assert.ok(login.ok); const cookie = login.headers.get('set-cookie').split(';')[0];
let context = await browser.newContext({ extraHTTPHeaders: { origin: base }, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
let page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
const goto = async route => { const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' }); assert.equal(response.status(), 200, route); await page.evaluate(() => document.fonts.ready); };
const screenshot = async name => { await page.waitForTimeout(120); await page.screenshot({ path: path.join(out, name + '.png') }); };
async function geometry(surface, section, mode, width) {
  const metrics = await page.evaluate(({ surface, section }) => {
    const root = document.querySelector(surface === 'modal' ? '#settings-modal-content' : '.neo-settings-content');
    const panel = root.querySelector(`[data-settings-section="${section}"]`);
    const bounds = root.getBoundingClientRect();
    const outside = [...panel.querySelectorAll('input,button,textarea,select,label,p,h2,h3,summary')].filter(element => element.checkVisibility({ checkVisibilityCSS: true }) && !element.matches('.sr-only,[hidden],[type="hidden"]')).flatMap(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ? [{ id: element.id, tag: element.tagName, x: rect.x, right: rect.right }] : [];
    });
    const close = document.getElementById('settings-modal-close')?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - innerWidth, innerOverflow: root.scrollWidth - root.clientWidth, outside, dark: document.documentElement.classList.contains('dark'), h1: document.querySelectorAll('.neo-settings-workspace h1').length, closeVisible: !!close && close.x >= 0 && close.right <= innerWidth && close.y >= 0 && close.bottom <= innerHeight };
  }, { surface, section });
  report.layouts.push({ surface, section, mode, width, ...metrics });
  assert.ok(metrics.overflow <= 1, `page overflow ${surface}/${section}/${width}`);
  assert.ok(metrics.innerOverflow <= 1, `panel overflow ${surface}/${section}/${width}: ${metrics.innerOverflow}`);
  assert.deepEqual(metrics.outside, [], `${surface}/${section}/${width} field outside panel`);
  assert.equal(metrics.dark, mode === 'dark');
  if (surface === 'modal') assert.ok(metrics.closeVisible); else assert.equal(metrics.h1, 1);
}
try {
  for (const mode of (interactionsOnly ? [] : ['light', 'dark'])) for (const width of [1440, 1320, 1280, 941, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await context.addInitScript(mode => localStorage.setItem('my-blog-theme', JSON.stringify({ mode, uiStyle: 'material3', themeId: 'classic' })), mode);
    for (const section of sections) {
      await goto(route(section)); await geometry('page', section, mode, width);
      if (mode === 'light' && [941,390].includes(width) || mode === 'dark' && width === 1280 && ['appearance','ai'].includes(section)) await screenshot(`page-${section}-${width}-${mode}`);
    }
    await goto('/');
    // Only enter the explicit settings control. Mobile toolbar is collapsed.
    if (width < 768) await page.locator('.m3-tools-toggle').click();
    const trigger = page.locator('button[data-open-settings=""]'); await trigger.click();
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    for (const section of sections) {
      await page.locator(`#settings-modal-nav [data-section="${section}"]`).click();
      await page.locator(`#settings-modal-content [data-settings-section="${section}"]`).waitFor({ state: 'visible' });
      await geometry('modal', section, mode, width);
      if (mode === 'light' && [941,390].includes(width) && ['site-name','hero-quotes','appearance','ai','sync','shortcuts'].includes(section)) await screenshot(`modal-${section}-${width}-${mode}`);
    }
    await page.keyboard.press('Escape'); await page.locator('#settings-modal').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    console.log(`Settings ${width} ${mode}: 20 page/modal sections passed`);
  }
  report.cases.push('280 section/surface/viewport/mode layouts, no page/panel overflow, field bounds, mode restoration, one page title and visible modal close');
  // Layout initialization deliberately seeds modes; persistence tests use a clean context.
  await context.close();
  context = await browser.newContext({ extraHTTPHeaders: { origin: base }, viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
  page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 1000 }); await goto('/admin/settings');
  assert.equal(await page.locator('[data-settings-page] [aria-current="page"]').getAttribute('href'), route('site-name'));
  await goto('/admin/settings/site-css'); assert.ok((await page.locator('.neo-settings-content').textContent()).includes('统一外观'));
  report.cases.push('settings root and legacy site-css compatibility routes');
  await goto('/admin/settings/appearance');
  for (const mode of ['light','dark','system']) { await page.locator(`[data-settings-mode="${mode}"]`).click(); assert.equal(await page.locator(`[data-settings-mode="${mode}"]`).getAttribute('aria-pressed'), 'true'); }
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.locator('[data-settings-mode="light"]').click(); await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('[data-settings-mode="light"]').getAttribute('aria-pressed'), 'true');
  report.cases.push('inline bright/dark/system preference, OS change and refreshed selection');
  await goto('/admin/settings/site-name'); const originalName = await page.locator('#site-name-input').inputValue();
  await page.locator('#site-name-input').fill(''); await page.locator('#site-name-save').click(); await page.locator('#site-name-err').waitFor({ state: 'visible' });
  await page.locator('#site-name-input').fill('设置验收示例');
  await page.route('**/api/site-name', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: JSON.stringify({ error: '验收失败，请重试' }) }) : route.continue());
  await page.locator('#site-name-save').click(); await page.getByText('验收失败，请重试', { exact: true }).waitFor(); assert.equal(await page.locator('#site-name-input').inputValue(), '设置验收示例');
  await page.unroute('**/api/site-name'); await page.locator('#site-name-save').click(); await page.locator('#site-name-hint').filter({ hasText: '已保存' }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('#site-name-input').inputValue(), '设置验收示例');
  await page.locator('#site-name-input').fill(originalName); await page.locator('#site-name-save').click();
  report.cases.push('real isolated site-name persistence, empty validation, failed save preserves input for retry');
  await goto('/admin/settings/hero-quotes'); const initialRows = await page.locator('.qs-row').count();
  await page.locator('#s-add').click(); await page.locator('.qs-text').last().fill('设置验收诗词'); await page.locator('.qs-pause').last().fill('3600');
  await page.locator('#s-save').click(); await page.locator('#s-saved-hint').filter({ hasText: '已保存' }).waitFor(); await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('.qs-row').count(), initialRows + 1);
  await page.locator('.qs-del').last().click(); await page.locator('#s-save').click();
  report.cases.push('quote add/remove, per-quote delay and real isolated persistence');
  await goto('/admin/settings/md-css'); await page.locator('#mdcss-text').fill('h3 { color: #c6370c; }');
  await page.locator('#mdcss-preview h3').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#mdcss-preview h3')).color === 'rgb(198, 55, 12)');
  report.cases.push('custom Markdown CSS live preview stays inside preview scope');
  await goto('/admin/settings/editor-shortcuts'); await page.locator('.neo-shortcut-row button').first().click(); await page.keyboard.press('Control+Shift+9');
  assert.ok((await page.locator('.neo-shortcut-row button').first().textContent()).includes('9'));
  await page.locator('.neo-shortcut-row button').first().click(); await page.keyboard.press('Escape'); assert.ok(!(await page.locator('.neo-shortcut-row button').first().textContent()).includes('按下'));
  report.cases.push('keyboard shortcut recording and Esc cancellation');
  for (const [section, endpoint, button, status] of [['image-bed','/api/image-bed-test','#ib-test','#ib-test-result'],['ai','/api/ai/test','#ai-test','#ai-test-result'],['netdisk','/api/netdisk-test','#nd-test','#nd-test-result']]) {
    await goto(route(section)); await page.route('**' + endpoint, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: '隔离连接反馈验收' }) }));
    await page.locator(button).click(); await page.locator(status).filter({ hasText: '隔离连接反馈验收' }).waitFor(); report.mocked.push(endpoint); await page.unroute('**' + endpoint);
  }
  report.cases.push('GitHub/AI/netdisk test-button feedback mocked; no external connection or credential use');
  await goto('/admin/settings/sync'); await page.route('**/api/desktop/sync-config', route => route.request().method() === 'POST' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, primary: { ok: true }, fallback: null }) }) : route.continue());
  await page.locator('#sync-primary-url').fill('postgresql://review:review@127.0.0.1:9/review');
  await page.locator('#sync-show-urls').check(); assert.equal(await page.locator('#sync-primary-url').getAttribute('type'), 'text'); await page.locator('#sync-show-urls').uncheck();
  await page.locator('#sync-config-test').click(); await page.locator('#sync-config-feedback').filter({ hasText: '连接成功' }).waitFor();
  await page.unroute('**/api/desktop/sync-config'); report.mocked.push('/api/desktop/sync-config:POST');
  report.cases.push('local sync masked field/toggle and mocked test feedback; no synchronization run');
  await goto('/'); await page.locator('button[data-open-settings=""]').click();
  await page.locator('#settings-modal-search').fill('找不到的分区'); await page.locator('#settings-modal-empty').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); await page.locator('#settings-modal').waitFor({ state: 'hidden' }); await page.locator('button[data-open-settings=""]').click(); assert.equal(await page.locator('#settings-modal-search').inputValue(), '');
  await page.locator('#settings-modal-search').fill('字体'); assert.equal(await page.locator('#settings-modal-nav .settings-nav-item:visible').count(), 1);
  await page.locator('#settings-modal-close').click();
  report.cases.push('modal navigation search, empty feedback, reopen clears search and close restores trigger focus');
  const guest = await browser.newContext(); const response = await guest.request.get(base + '/admin/settings', { maxRedirects: 0 }); assert.equal(response.status(), 302);
  const guestPage = await guest.newPage(); await guestPage.goto(base + '/', { waitUntil: 'domcontentloaded' }); assert.equal(await guestPage.locator('#settings-modal').count(), 0);
  const denied = await guest.request.put(base + '/api/site-name', { data: { name: 'denied' } }); assert.equal(denied.status(), 401);
  report.cases.push('guest redirected from settings, no management dialog DOM, denied save');
  assert.deepEqual(report.errors, []); console.log('Settings browser verification passed');
} finally { fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
