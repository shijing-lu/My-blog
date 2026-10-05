/** Settings geometry and interaction checks on copied data. All writes are mocked or blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.MATERIAL_VERIFY_BASE || 'http://127.0.0.1:43221';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = path.resolve('outputs/material3-review/repair-1.1.1');
fs.mkdirSync(output, { recursive: true });
const interactionsOnly = process.env.MATERIAL_SETTINGS_INTERACTIONS_ONLY === '1';
const previous = interactionsOnly ? JSON.parse(fs.readFileSync(path.join(output, 'settings-verification.json'))) : null;
const report = { samples: previous?.samples ?? [], interactions: [], failures: previous?.failures ?? [], errors: previous?.errors ?? [], blockedWrites: [] };
const save = () => fs.writeFileSync(path.join(output, 'settings-verification.json'), JSON.stringify(report, null, 2));
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.MATERIAL_VERIFY_PASSWORD || 'material3-local-check' }) });
assert.equal(login.ok, true);
const cookie = login.headers.get('set-cookie').split(';')[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const styleState = (style, mode) => ({ themeId: '', uiStyle: style, mode });
async function makeContext(style, mode, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
  await context.addInitScript(value => localStorage.setItem('my-blog-theme', JSON.stringify(value)), styleState(style, mode));
  await context.route('**/api/**', route => {
    if (/^(POST|PUT|PATCH|DELETE)$/.test(route.request().method())) { report.blockedWrites.push(new URL(route.request().url()).pathname); return route.abort(); }
    return route.continue();
  });
  return context;
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function openSettings(page, style) {
  if (style === 'material3') await page.locator('.m3-tools-toggle').click();
  await page.locator('button[data-open-settings=""]').click();
}
async function sample(page, profile, section, surface) {
  const result = await page.evaluate(({ surface, section }) => {
    const dialog = document.querySelector('#settings-modal');
    const body = surface === 'modal' ? document.querySelector('#settings-modal-content') : document.querySelector('[data-settings-page]');
    const panel = surface === 'modal' ? body.querySelector(`[data-settings-section="${section}"]`) : body;
    const bounds = body.getBoundingClientRect();
    const visible = element => element.checkVisibility({ checkVisibilityCSS: true }) && element.getBoundingClientRect().width > 0;
    const outside = [...panel.querySelectorAll('button, input, select, textarea, p, label, h2, h3, fieldset, summary')].filter(visible).filter(element => !element.matches('.sr-only,[type="hidden"]')).flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) return [];
      return [{ id: element.id, tag: element.tagName, x: rect.x, width: rect.width, text: element.matches('input,textarea') ? '' : element.textContent?.trim().slice(0, 80) }];
    });
    const narrowFields = [...panel.querySelectorAll('input[type="text"],input:not([type]),select,textarea')].filter(visible).filter(e => !e.closest('.qs-row')).flatMap(element => element.getBoundingClientRect().width < Math.min(140, bounds.width / 2) ? [{ id: element.id, width: element.getBoundingClientRect().width }] : []);
    const close = dialog?.querySelector('#settings-modal-close').getBoundingClientRect();
    const root = dialog?.getBoundingClientRect();
    return {
      section, surface, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
      rootWidth: root?.width, rootScrollWidth: dialog?.scrollWidth, rootScrollLeft: dialog?.scrollLeft,
      closeVisible: close && close.left >= 0 && close.right <= innerWidth && close.top >= 0 && close.bottom <= innerHeight,
      active: dialog?.dataset.activeSection, outside, narrowFields,
      normalWrap: getComputedStyle(body).whiteSpace === 'normal',
      navOverflow: dialog ? getComputedStyle(document.querySelector('#settings-modal-nav')).overflowX : null,
    };
  }, { surface, section });
  report.samples.push({ profile, ...result });
  if (profile.startsWith('material3') && (result.outside.length || result.narrowFields.length || result.bodyScrollWidth > result.bodyWidth + 1 || !result.normalWrap || (surface === 'modal' && (!result.closeVisible || result.rootScrollWidth > result.rootWidth + 1 || result.active !== section)))) {
    report.failures.push({ profile, ...result });
    console.log(`SETTINGS_FAILURE ${profile} ${surface} ${section} outside=${result.outside.length} scroll=${result.bodyScrollWidth}/${result.bodyWidth} root=${result.rootScrollWidth}/${result.rootWidth}`);
  }
  return result;
}
const profiles = interactionsOnly ? [] : ['material3', 'classic'].flatMap(style => ['light', 'dark', 'system'].flatMap(mode => [320, 390, 768, 839, 840, 1280, 1920].map(width => ({ style, mode, width }))));
let next = 0;
try {
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < profiles.length) {
      const { style, mode, width } = profiles[next++];
      const profile = `${style}-${mode}-${width}`;
      const context = await makeContext(style, mode, width);
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push({ profile, message: error.message }));
      await page.goto(base, { waitUntil: 'networkidle' });
      await openSettings(page, style);
      const sections = await page.locator('#settings-modal-nav [data-section]').evaluateAll(elements => elements.map(element => element.dataset.section));
      for (const section of sections) {
        await page.locator(`#settings-modal-nav [data-section="${section}"]`).click();
        await page.locator(`#settings-modal [data-settings-section="${section}"]`).waitFor({ state: 'visible' });
        await page.locator(`#settings-modal [data-settings-section="${section}"] details[data-classic-settings]`).evaluateAll(elements => elements.forEach(element => { element.open = true; }));
        await settle(page);
        await sample(page, profile, section, 'modal');
        if (style === 'material3' && mode === 'light' && ['appearance', 'md-css', 'ai'].includes(section) && [320, 390, 840, 1280].includes(width)) {
          await page.screenshot({ path: path.join(output, `settings-${section}-${width}.png`) });
        }
      }
      await page.locator('#settings-modal-close').click();
      await page.locator('#theme-settings-btn').click();
      await settle(page);
      const device = await page.locator('#theme-settings-dialog').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, labels: [...element.querySelectorAll('[data-ui-style-btn]')].map(button => ({ text: button.textContent.trim(), width: button.clientWidth, scrollWidth: button.scrollWidth })), avatarWidth: document.querySelector('[data-profile-avatar]')?.getBoundingClientRect().width }));
      report.samples.push({ profile, surface: 'device', ...device });
      if (style === 'material3' && (device.scrollWidth > device.width + 1 || device.labels.some(label => label.scrollWidth > label.width + 1) || device.avatarWidth < 30)) report.failures.push({ profile, ...device });
      if (style === 'material3' && mode === 'light') await page.screenshot({ path: path.join(output, `device-${width}.png`) });
      await page.locator('#settings-close').click();
      for (const section of sections) {
        const route = section === 'shortcuts' ? 'editor-shortcuts' : section;
        await page.goto(base + `/admin/settings/${route}`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-settings-page]').waitFor();
        await page.locator('[data-settings-page] details[data-classic-settings]').evaluateAll(elements => elements.forEach(element => { element.open = true; }));
        await settle(page);
        await sample(page, profile, section, 'page');
      }
      await context.close(); save();
      console.log(`SETTINGS_PROFILE_DONE ${profile}`);
    }
  }));
  const context = await makeContext('material3', 'light', 390);
  const page = await context.newPage();
  await page.goto(base);
  const trigger = page.locator('button[data-open-settings=""]');
  await openSettings(page, 'material3');
  const dialog = page.locator('#settings-modal');
  await page.locator('#settings-modal-search').fill('Material');
  assert.equal(await page.locator('#settings-modal-nav button:visible').count(), 1);
  assert.equal(await page.locator('#settings-modal-nav button:visible').getAttribute('data-section'), 'appearance');
  await page.locator('#settings-modal-search').fill('不存在的设置123');
  await page.locator('#settings-modal-empty').waitFor({ state: 'visible' });
  await page.locator('#settings-modal-search').fill('');
  await page.locator('#settings-modal-nav [data-section="appearance"]').click();
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press(index < 9 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    assert.equal(await dialog.evaluate(element => element.scrollLeft), 0);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  report.interactions.push({ name: 'search-keywords-empty-focus-Tab-ShiftTab-Escape', passed: true });
  await trigger.click();
  await page.locator('#settings-modal-nav [data-section="appearance"]').click();
  await dialog.locator('details[data-classic-settings]').first().evaluate(element => { element.open = true; });
  const input = dialog.locator('#font-name');
  await input.fill('未保存的测试值');
  for (const width of [839, 840, 390, 1280]) { await page.setViewportSize({ width, height: 900 }); await settle(page); assert.equal(await dialog.evaluate(element => element.open), true); assert.equal(await input.inputValue(), '未保存的测试值'); }
  for (const style of ['classic', 'material3']) {
    await page.evaluate(value => { const newValue = JSON.stringify(value); localStorage.setItem('my-blog-theme', newValue); window.dispatchEvent(new StorageEvent('storage', { key: 'my-blog-theme', newValue, storageArea: localStorage })); }, styleState(style, 'light'));
    await settle(page); assert.equal(await dialog.evaluate(element => element.open), true); assert.equal(await input.inputValue(), '未保存的测试值');
  }
  report.interactions.push({ name: 'open-dialog-resize-style-switch-unsaved-fields', passed: true });
  await dialog.locator('details[data-classic-settings]').first().evaluate(element => { element.open = false; });
  const saveButton = dialog.locator('[data-ui-style-save]');
  for (const success of [false, true]) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/ui-style', async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      await gate;
      return route.fulfill({ status: success ? 200 : 500, contentType: 'application/json', body: JSON.stringify(success ? { defaultStyle: 'material3' } : { error: '模拟保存失败' }) });
    });
    await dialog.locator('input[name="site-ui-default-style"][value="material3"]').check();
    await saveButton.click();
    assert.equal(await saveButton.isDisabled(), true);
    assert.match(await dialog.locator('[data-ui-style-status]').innerText(), /正在保存/);
    release();
    await page.waitForFunction(() => !document.querySelector('#settings-modal [data-ui-style-save]').disabled);
    assert.match(await dialog.locator('[data-ui-style-status]').innerText(), success ? /已保存/ : /模拟保存失败/);
    if (!success) assert.equal(await dialog.locator('input[name="site-ui-default-style"][value="classic"]').isChecked(), true);
    await page.unroute('**/api/ui-style');
  }
  report.interactions.push({ name: 'mocked-save-loading-error-rollback-success', passed: true });
  await context.close();
} finally { await browser.close(); save(); }
console.log(`SETTINGS_RESULT samples=${report.samples.length} interactions=${report.interactions.length} failures=${report.failures.length} errors=${report.errors.length} blockedWrites=${report.blockedWrites.length}`);
if (report.failures.length || report.errors.length || report.blockedWrites.length) process.exitCode = 1;
