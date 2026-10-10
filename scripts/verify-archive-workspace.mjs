import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out = path.resolve('outputs/archive-workspace'), base = 'http://127.0.0.1:43228';
const report = { layouts: [], interactions: [], audit: [], errors: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(mode => localStorage.setItem('my-blog-theme', JSON.stringify({ mode })), mode);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    for (const width of [1440, 1320, 1280, 941, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + '/archive'); await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => {
        const card = document.querySelector('.archive-card'), style = getComputedStyle(card);
        const toolbar = document.querySelector('.side-toolbar'), tr = toolbar?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('h1').length,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', border: style.borderTopWidth,
          count: document.querySelectorAll('[data-archive-item]').length,
          toolbarOverlap: tr && tr.width < 100 && [...document.querySelectorAll('.archive-card')].some(card => { const r = card.getBoundingClientRect(); return r.right > tr.left && r.left < tr.right && r.top < tr.bottom && r.bottom > tr.top; }) };
      });
      assert.ok(metrics.overflow <= 1, `${width}/${mode} overflow`); assert.equal(metrics.h1, 1); assert.equal(metrics.theme, mode);
      assert.equal(metrics.border, '2px'); assert.ok(metrics.count >= 9); assert.ok(!metrics.toolbarOverlap);
      report.layouts.push({ width, mode, ...metrics });
      if ([1440, 941, 390, 360].includes(width)) await page.screenshot({ path: path.join(out, `archive-${width}-${mode}.png`) });
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + '/archive');
  const total = await page.locator('[data-archive-item]').count();
  const tag = page.locator('.neo-archive-sidebar [data-filter-tag="归档验收"]');
  await tag.click();
  assert.equal(await page.locator('[data-archive-item]:visible').count(), 9);
  assert.equal(await page.locator('#archive-filter-count').textContent(), '9 篇');
  assert.equal(await page.locator('#archive-filter-name').textContent(), '#归档验收');
  assert.equal(await page.locator('[data-archive-all]').getAttribute('aria-pressed'), 'false');
  await page.screenshot({ path: path.join(out, 'archive-filtered-1440.png') });
  const groups = await page.locator('[data-archive-year]:visible').evaluateAll(groups => groups.map(group => ({ count: group.querySelector('.archive-year-count').textContent, visible: group.querySelectorAll('[data-archive-item]:not(.hidden)').length })));
  for (const group of groups) assert.equal(group.count, `${group.visible} 篇`);
  assert.equal(await page.locator('.archive-protected:visible').count(), 1);
  await tag.click(); assert.equal(await page.locator('[data-archive-item]:visible').count(), total);
  const category = page.locator('.neo-archive-categories [data-filter-category]:not(:disabled)').first();
  if (await category.count()) {
    const id = await category.getAttribute('data-filter-category');
    await tag.click();
    await category.click();
    assert.equal(await tag.getAttribute('aria-pressed'), 'false');
    assert.ok(await page.locator('[data-archive-item]:visible').evaluateAll((items, id) => items.every(item => item.dataset.category === id), id));
    await tag.click();
    assert.equal(await category.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('[data-archive-item]:visible').count(), 9);
    await page.locator('[data-archive-all]').click();
    assert.equal(await page.locator('[data-archive-item]:visible').count(), total);
  }
  // Empty result: exercise the unchanged filter contract with a temporary DOM-only option.
  await page.evaluate(() => { const button = document.createElement('button'); button.dataset.filterTag = 'empty-review'; button.id = 'empty-review'; button.textContent = '空结果验收'; document.querySelector('.neo-archive-categories').append(button); });
  await page.locator('#empty-review').click(); assert.equal(await page.locator('[data-archive-year]:visible').count(), 0);
  await page.locator('#archive-filter-empty').waitFor({ state: 'visible' }); await page.locator('#archive-filter-clear').click();
  assert.equal(await page.locator('[data-archive-item]:visible').count(), total);
  report.interactions.push('标签切换及再次点击取消', '分类与标签互斥', '全部与清除', '年/月分组及命中数', '加密状态', '空筛选结果');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.archive-filter-mobile summary').click();
  await page.locator('.archive-filter-mobile [data-filter-tag="归档验收"]').click();
  assert.equal(await page.locator('[data-archive-item]:visible').count(), 9);
  await page.locator('#archive-filter-clear').click();
  assert.equal(await page.locator('.archive-filter-mobile [data-filter-tag="归档验收"]').getAttribute('aria-pressed'), 'false');
  report.interactions.push('手机筛选展开与同步选中态');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.neo-archive-sidebar [data-filter-tag="归档验收"]').click();
  const articleHref = await page.locator('[data-archive-item]:visible a').first().getAttribute('href');
  await page.locator('[data-archive-item]:visible a').first().click(); await page.waitForURL(url => url.pathname === articleHref);
  await page.goBack(); await page.waitForURL('**/archive');
  await page.locator('.neo-archive').waitFor({ state: 'visible' });
  await page.waitForFunction(total => [...document.querySelectorAll('[data-archive-item]')].filter(item => item.checkVisibility()).length === total, total);
  assert.equal(await page.locator('[data-archive-item]:visible').count(), total);
  await page.locator('.neo-archive-sidebar [data-filter-tag="归档验收"]').click();
  assert.equal(await page.locator('[data-archive-item]:visible').count(), 9);
  await page.locator('#archive-filter-clear').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-archive-item]:visible').count(), total);
  report.interactions.push('文章详情与浏览器返回后重新筛选', '键盘清除');
  // Source-audit candidates: read-only snapshots of the current unfinished content shells.
  for (const route of ['/login', '/manage', '/404', '/tags/归档验收', '/demo']) {
    const response = await page.goto(base + route);
    report.audit.push({ route, status: response.status(), title: await page.title(), h1: await page.locator('h1').allTextContents() });
    await page.screenshot({ path: path.join(out, `audit-${route.slice(1).replaceAll('/', '-')}.png`) });
  }
  const login = await context.request.post(base + '/api/login', { data: { password: 'article-review-local' } }); assert.ok(login.ok());
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: '本轮页面盘点为只读检查' }) }));
  for (const route of ['/quick-notes', '/admin/auth', '/admin/netdisk', '/admin/mindmaps']) {
    const response = await page.goto(base + route);
    report.audit.push({ route, status: response.status(), title: await page.title(), h1: await page.locator('h1').allTextContents() });
    await page.screenshot({ path: path.join(out, `audit-${route.slice(1).replaceAll('/', '-')}.png`) });
  }
  const mapLink = await page.locator('a[href^="/admin/mindmaps/"]').first().getAttribute('href');
  if (mapLink) {
    const response = await page.goto(base + mapLink);
    await page.locator('#map-title').waitFor();
    report.audit.push({ route: '/admin/mindmaps/:id', status: response.status(), title: await page.title() });
    await page.screenshot({ path: path.join(out, 'audit-map-editor.png') });
  }
  for (const width of [941, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(base + '/archive');
    const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, buttons: document.querySelectorAll('[data-archive-item] button').length }));
    assert.ok(metrics.overflow <= 1); assert.equal(metrics.buttons, 0);
    report.layouts.push({ width, mode: 'light', identity: 'owner', ...metrics });
  }
  await context.close();
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`ARCHIVE_OK layouts=${report.layouts.length} interactions=${report.interactions.length} audited=${report.audit.length}`);
