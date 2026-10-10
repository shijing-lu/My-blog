import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out = path.resolve('outputs/moments-workspace');
const server = JSON.parse(fs.readFileSync(path.join(out, 'server.json'), 'utf8'));
assert.equal(server.databasePath, path.join(out, 'test.db')); assert.equal(server.port, 43224);
const fixture = JSON.parse(fs.readFileSync(path.join(out, 'fixtures.json'), 'utf8'));
const base = `http://127.0.0.1:${server.port}`;
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-review-local' }) });
assert.ok(login.ok); const cookie = login.headers.get('set-cookie').split(';')[0];
const report = { layouts: [], cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = {};
for (const identity of ['guest', 'owner']) {
  const context = await browser.newContext({ extraHTTPHeaders: { origin: base }, viewport: { width: 1440, height: 900 } });
  if (identity === 'owner') await context.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
  contexts[identity] = context;
}
const screenshot = async (page, name, fullPage = false) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(320); await page.screenshot({ path: path.join(out, name + '.png'), fullPage }); };
const goto = async (page, route) => { const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' }); assert.equal(response.status(), 200, route); await page.evaluate(() => document.fonts.ready); };
try {
  for (const identity of ['guest', 'owner']) {
    const page = await contexts[identity].newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    for (const mode of ['light', 'dark']) for (const width of [1440, 1320, 1280, 941, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(mode => localStorage.setItem('my-blog-theme', JSON.stringify({ mode, uiStyle: 'classic', themeId: 'material3' })), mode);
      for (const [name, route] of [['feed', '/moments'], ['detail', '/moments/' + fixture.grid]]) {
        await goto(page, route); await page.waitForTimeout(120);
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('.neo-moments h1').length, dark: document.documentElement.classList.contains('dark'), composer: !!document.getElementById('moment-content'), actions: document.querySelectorAll('[data-moment-edit]').length, border: getComputedStyle(document.querySelector('.moment-card')).borderTopWidth }));
        assert.ok(metrics.overflow <= 1, `${identity}/${name}/${width}/${mode}: ${metrics.overflow}px overflow`);
        assert.equal(metrics.h1, 1); assert.equal(metrics.dark, mode === 'dark'); assert.equal(metrics.border, '2px');
        if (identity === 'guest') { assert.equal(metrics.composer, false); assert.equal(metrics.actions, 0); assert.equal(await page.locator('#moment-edit-dialog').count(), 0); }
        report.layouts.push({ identity, name, width, mode, ...metrics });
        if ((mode === 'light' && [1440, 941, 390].includes(width)) || mode === 'dark' && width === 1280) await screenshot(page, `${identity}-${name}-${width}-${mode}`);
      }
      if (identity === 'owner') {
        await goto(page, '/moments'); await page.locator(`[data-moment-edit="${fixture.text}"]`).click();
        await page.locator('#moment-edit-dialog').waitFor({ state: 'visible' });
        const overflow = await page.locator('#moment-edit-dialog').evaluate(dialog => dialog.scrollWidth - dialog.clientWidth);
        assert.ok(overflow <= 1, `dialog/${width}/${mode} overflow ${overflow}`);
        report.layouts.push({ identity, name: 'edit-dialog', width, mode, overflow });
        if (mode === 'light' && [941, 390].includes(width) || mode === 'dark' && width === 1280) await screenshot(page, `edit-${width}-${mode}`);
        await page.keyboard.press('Escape'); await page.locator('#moment-edit-dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.momentEdit), fixture.text);
      }
      console.log(`Moments ${identity} ${width} ${mode} layout group passed`);
    }
    await page.close();
  }
  report.cases.push('70 layouts: guest/owner feed/detail plus owner edit modal at seven widths, light/dark, no page overflow, one title, permissions and Esc focus restoration');
  const page = await contexts.owner.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await goto(page, '/moments');
  const initial = await page.locator('.moment-card').count(); assert.equal(initial, 20);
  await page.locator('#moment-sentinel').scrollIntoViewIfNeeded(); await page.locator('#moment-more').click();
  await page.waitForFunction(count => document.querySelectorAll('.moment-card').length > count, initial);
  assert.equal(await page.locator('.moment-card').evaluateAll(cards => new Set(cards.map(card => card.dataset.momentId)).size), await page.locator('.moment-card').count());
  report.cases.push('SSR and load-more share complete cards and hydrate without duplicate IDs');
  await page.locator('#moment-search').fill('没有符合条件的验收关键词');
  await page.locator('.moments-empty').waitFor(); assert.ok((await page.locator('.moments-empty').textContent()).includes('没有符合条件'));
  await screenshot(page, 'empty-search'); await page.locator('[data-filter-clear]').click(); await page.locator('.moment-card').first().waitFor();
  await page.locator('[data-filter-tag="图片"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 1);
  assert.equal(await page.locator('.moment-card').getAttribute('data-moment-id'), fixture.grid);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 1);
  assert.equal(await page.locator('[data-filter-tag="图片"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-filter-clear]').click(); await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 20);
  const date = await page.locator('[data-timeline-date]').first().getAttribute('data-timeline-date');
  await page.locator('[data-timeline-date]').first().click(); await page.waitForFunction(() => document.querySelector('[data-timeline-date].active'));
  assert.ok(new URL(page.url()).searchParams.get('date') === date); await page.locator('[data-filter-clear]').click();
  await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 20);
  report.cases.push('search empty state, clear, full-data tags, URL refresh restoration and selected timeline feedback');
  await page.locator('#moment-content').fill('**发布验收内容**'); await page.locator('#moment-preview-toggle').click(); await page.locator('#moment-content-preview strong').waitFor();
  const countBefore = Number(await page.locator('[data-moment-total]').textContent());
  await page.locator('#moment-tags-input').fill('交互验收'); await page.locator('#moment-visibility').selectOption('private');
  const publish = page.waitForResponse(response => response.url().endsWith('/api/moments') && response.request().method() === 'POST');
  await page.locator('#moment-publish').click(); const published = await publish; assert.ok(published.ok()); const created = (await published.json()).moment.id;
  await page.locator(`[data-moment-id="${created}"]`).waitFor(); assert.equal(await page.locator('#moment-content').inputValue(), '');
  assert.equal(Number(await page.locator('[data-moment-total]').textContent()), countBefore + 1);
  await page.locator(`[data-moment-edit="${created}"]`).click(); await page.locator('#moment-edit-dialog').waitFor({ state: 'visible' });
  await page.locator('#moment-edit-content').fill('**编辑后验收内容**'); await page.locator('#moment-edit-preview-btn').click(); await page.locator('#moment-edit-preview strong').waitFor();
  await page.route(`**/api/moments/${created}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, body: '{}' }) : route.continue());
  await page.locator('#moment-edit-save').click(); await page.locator('#moment-edit-status').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#moment-edit-content').inputValue(), '**编辑后验收内容**');
  await page.unroute(`**/api/moments/${created}`);
  await page.locator('#moment-edit-save').click(); await page.locator('#moment-edit-dialog').waitFor({ state: 'hidden' });
  assert.ok((await page.locator(`[data-moment-id="${created}"]`).textContent()).includes('编辑后验收内容'));
  await page.route(`**/api/moments/${created}`, route => route.request().method() === 'DELETE' ? route.fulfill({ status: 500, body: '{}' }) : route.continue());
  await page.locator(`[data-moment-del="${created}"]`).click(); await page.locator('[data-confirm-ok]').click();
  await page.locator(`[data-moment-del="${created}"]`).filter({ hasText: '删除失败' }).waitFor(); assert.equal(await page.locator(`[data-moment-id="${created}"]`).count(), 1);
  await page.unroute(`**/api/moments/${created}`);
  await page.locator(`[data-moment-del="${created}"]`).click(); await page.locator('[data-confirm-ok]').click(); await page.locator(`[data-moment-id="${created}"]`).waitFor({ state: 'detached' });
  assert.equal(Number(await page.locator('[data-moment-total]').textContent()), countBefore);
  report.cases.push('private publish and preview, in-place editing and preview, failed save retains text for retry, failed deletion retains card, successful delete and real count updates');
  const uploaded = [];
  // Storage is external in this project: exercise the picker/paste protocol without writing to R2 or GitHub.
  await page.route('**/api/images', async route => { uploaded.push(route.request().postDataJSON()); await new Promise(resolve => setTimeout(resolve, 200)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: '/images/neobrutalism/cat-peek.webp' }) }); });
  await page.locator('#moment-file').setInputFiles(path.resolve('public/images/neobrutalism/cat-rest.webp'));
  await page.waitForFunction(() => document.getElementById('moment-publish').disabled);
  await page.locator('#moment-media-preview img').waitFor();
  await page.locator('#moment-file').setInputFiles({ name: 'review.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
  await page.waitForFunction(() => document.querySelectorAll('#moment-media-preview img').length === 2);
  assert.equal(uploaded[1].mime, 'image/gif');
  await page.locator('#moment-media-preview button').first().click(); await page.locator('#moment-media-preview button').first().click();
  await page.locator('#moment-video-url').fill('invalid'); await page.locator('#moment-video-add').click(); assert.ok((await page.locator('#moment-status').textContent()).includes('合法'));
  await page.locator('#moment-video-url').fill('https://example.invalid/review.mp4'); await page.locator('#moment-video-add').click(); assert.equal(await page.locator('#moment-media-preview > div').count(), 1); await page.locator('#moment-media-preview button').click();
  await page.unroute('**/api/images');
  report.cases.push('picker images and GIF upload protocol mocked at external storage boundary, upload disables publish, media removal and video URL validation');
  await page.locator('.neo-site-navigation a[href="/doc"]').click(); await page.waitForURL('**/doc');
  await page.locator('.neo-site-navigation a[href="/moments"]').click(); await page.waitForURL('**/moments');
  await page.locator('#moment-content').fill('**跨页返回预览**'); await page.locator('#moment-preview-toggle').click(); await page.locator('#moment-content-preview strong').waitFor();
  report.cases.push('ClientRouter leave/return rebinds to new publishing and preview elements');
  await goto(page, '/moments/' + fixture.grid);
  const figure = page.locator('.moment-media').first(); await figure.focus(); await page.keyboard.press('Enter'); await page.locator('.lightbox-overlay[open]').waitFor(); await page.keyboard.press('Escape'); await page.locator('.lightbox-overlay[open]').waitFor({ state: 'hidden' });
  assert.equal(await figure.evaluate(element => document.activeElement === element), true);
  await goto(page, '/moments/' + fixture.video); await page.locator('[data-media-failed="true"]').waitFor(); await screenshot(page, 'media-failure');
  report.cases.push('keyboard image lightbox, Esc focus restoration and stable broken-image placeholder');
  const guest = await contexts.guest.newPage(); await goto(guest, '/moments');
  assert.ok(!(await guest.locator('body').textContent()).includes('PRIVATE_MOMENT_REVIEW_SENTINEL'));
  assert.equal(await guest.locator('[data-filter-tag="仅私密标签"]').count(), 0);
  const denied = await contexts.guest.request.get(base + '/api/moments/' + fixture.private); assert.equal(denied.status(), 404);
  const privatePartial = await contexts.guest.request.get(base + '/moments/cards?id=' + fixture.private); assert.ok(!(await privatePartial.text()).includes('PRIVATE_MOMENT_REVIEW_SENTINEL'));
  const unauthorized = await contexts.guest.request.post(base + '/api/moments', { data: { content: 'guest denied' } }); assert.equal(unauthorized.status(), 401);
  await goto(guest, '/moments/' + fixture.text);
  await guest.locator('astro-island[ssr]').waitFor({ state: 'detached' });
  const likeResponse = guest.waitForResponse(response => response.url().endsWith('/api/likes/toggle'));
  await guest.getByRole('button', { name: '点赞', exact: true }).click(); assert.ok((await likeResponse).ok());
  assert.equal(await guest.getByRole('button', { name: '取消点赞', exact: true }).getAttribute('aria-pressed'), 'true');
  await guest.getByRole('button', { name: '取消点赞', exact: true }).click(); await guest.getByRole('button', { name: '点赞', exact: true }).waitFor();
  await guest.getByRole('button', { name: '评论', exact: true }).click(); await guest.getByRole('textbox', { name: '昵称' }).fill('动态验收访客');
  const commentText = '本地评论验收 ' + Date.now(); await guest.getByRole('textbox', { name: '评论内容' }).fill(commentText);
  const commentResponse = guest.waitForResponse(response => response.url().endsWith('/api/comments') && response.request().method() === 'POST');
  await guest.getByRole('button', { name: '发布', exact: true }).click(); assert.equal((await commentResponse).status(), 201); await guest.getByText(commentText, { exact: true }).waitFor();
  await guest.getByRole('button', { name: '折叠评论', exact: true }).click(); assert.equal(await guest.getByText(commentText, { exact: true }).isVisible(), false);
  await guest.getByRole('button', { name: '展开评论', exact: true }).click(); await guest.getByText(commentText, { exact: true }).waitFor();
  report.cases.push('real local content like/unlike and anonymous comment publish/collapse/expand using existing APIs');
  await guest.setViewportSize({ width: 390, height: 844 }); await goto(guest, '/moments'); assert.equal(await guest.locator('.moments-timeline').getAttribute('open'), null);
  await guest.locator('.moments-timeline summary').click(); assert.equal(await guest.locator('.moments-timeline').getAttribute('open'), '');
  assert.ok(await guest.locator('.timeline-item').first().evaluate(element => element.getBoundingClientRect().height) >= 44);
  report.cases.push('guest private content/tag/partial protections and denied publishing; mobile date toggle and 44px rows');
  await guest.emulateMedia({ reducedMotion: 'reduce' }); await goto(guest, '/moments/' + fixture.single); assert.equal(await guest.locator('.moment-card').evaluate(element => getComputedStyle(element).animationName), 'none');
  report.cases.push('reduced-motion rendering');
  assert.deepEqual(report.errors, []);
  console.log('All Moments browser cases passed');
} finally {
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
