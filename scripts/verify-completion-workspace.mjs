import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { chromium } from 'playwright-core';
import Database from 'better-sqlite3';
const out = path.resolve('outputs/completion-workspace'), base = 'http://127.0.0.1:43230';
const report = { layouts: [], interactions: [], errors: [] };
const fixtureDb = new Database(path.join(out, 'test.db'));
try {
  fixtureDb.prepare("DELETE FROM admin_accounts WHERE github_id=9100010 AND login='review-app-0'").run();
  fixtureDb.prepare('INSERT OR REPLACE INTO admin_applications (id,github_id,login,name,avatar_url,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('completion-app-0', 9100010, 'review-app-0', '验收示例申请人 1', '', '本地权限界面验收示例，无需真实 GitHub 账号。', 'pending', Date.now(), Date.now());
} finally { fixtureDb.close(); }
if (process.argv.includes('--interactions-only')) report.layouts = JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json'))).layouts;
const routes = ['/tags/归档验收', '/quick-notes', '/admin/auth', '/admin/netdisk', '/admin/mindmaps', '/admin/mindmaps/completion-map-example', '/login', '/manage', '/404', '/demo', '/design/material3', '/schedule/motion-lab'];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
function userCookie(uid) {
  const body = Buffer.from(JSON.stringify({ purpose: 'user-session', uid, exp: Date.now() + 3600000 })).toString('base64url');
  const signature = createHmac('sha256', createHash('sha256').update('completion-review-isolated-secret').digest()).update(body).digest('hex');
  return { name: 'user_session', value: body + '.' + signature, url: base };
}
async function mockNetdisk(page) {
  await page.route('**/api/netdisk/**', async route => {
    const api = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    const data = api.endsWith('/list') ? { ok: true, path: body.path, total: 2, items: body.path === '/' ? [{ name: '验收文件夹', is_dir: true, size: 0 }, { name: '长文件名称'.repeat(15) + '.md', is_dir: false, size: 2048 }] : [{ name: '学习笔记.md', is_dir: false, size: 512 }] } : api.endsWith('/links') ? { ok: true, links: ['https://example.invalid/review.md'], total: 1 } : { ok: true, url: 'https://example.invalid/review.md' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}
try {
  for (const mode of process.argv.includes('--interactions-only') ? [] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(mode => localStorage.setItem('my-blog-theme', JSON.stringify({ mode })), mode);
    const login = await context.request.post(base + '/api/login', { data: { password: 'article-review-local' } }); assert.ok(login.ok());
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message)); await mockNetdisk(page);
    // Layout testing is read-only, including the map's view-change save events.
    await page.route('**/api/mindmaps/**', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    for (const width of [1440,1320,1280,941,768,390,360]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        const response = await page.goto(base + route); assert.ok(response.status() < 500);
        await page.evaluate(() => document.fonts.ready);
        if (route.includes('motion-lab')) await page.locator('.neo-motion-lab').waitFor();
        if (route.includes('completion-map-example')) await page.locator('[data-map-canvas]').waitFor();
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('h1').length,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', fieldsOutside: [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(field => field.checkVisibility()).flatMap(field => { const r = field.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 ? [field.id] : []; }) }));
        assert.ok(metrics.overflow <= 1, `${route} ${width} ${mode}: overflow=${metrics.overflow}`);
        assert.equal(metrics.h1, 1, route); assert.equal(metrics.theme, mode); assert.deepEqual(metrics.fieldsOutside, [], route);
        report.layouts.push({ route, width, mode, status: response.status(), ...metrics });
        if ((mode === 'light' && [941,390].includes(width)) || (mode === 'dark' && width === 1280)) await page.screenshot({ path: path.join(out, route.slice(1).replaceAll('/','-') + '-' + width + '-' + mode + '.png') });
      }
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 941, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + '/login?next=%2Fquick-notes');
  await page.locator('#login-password').fill('incorrect-review-password'); await page.locator('#login-form button').click(); await page.locator('#login-error').waitFor({ state: 'visible' });
  await page.locator('#login-password').fill('article-review-local'); await page.locator('#login-form button').click(); await page.waitForURL('**/quick-notes');
  const count = await page.locator('[data-note-id]').count(); assert.ok(count >= 20);
  await page.locator('#quick-note-search').fill('本页不会有这个关键词'); assert.equal(await page.locator('[data-note-id]:visible').count(), 0); await page.locator('#quick-note-search-empty').waitFor({ state: 'visible' });
  await page.locator('#quick-note-search').fill('验收示例'); assert.ok(await page.locator('[data-note-id]:visible').count());
  await page.locator('#quick-note-search').fill(''); assert.equal(await page.locator('[data-note-id]:visible').count(), count);
  await page.locator('nav[aria-label="随心录分页"]').getByText('下一页').click(); await page.waitForURL('**/quick-notes?page=2'); assert.ok(await page.locator('[data-note-id]').count());
  await page.locator('.neo-notes-sidebar a').filter({ hasText: '收尾验收' }).click(); await page.waitForURL(url => url.searchParams.get('tag') === '收尾验收');
  assert.ok(await page.locator('.neo-notes-sidebar [aria-current="true"]').count());
  report.interactions.push('错误密码、正确密码及 next 跳转', '随心录本页搜索、清除、空结果、分页与标签');
  await page.locator('[data-note-open]').first().click(); await page.locator('[role="dialog"]').filter({ hasText: '随心录' }).first().waitFor(); await page.keyboard.press('Escape');
  report.interactions.push('随心录编辑浮窗打开与 Esc');
  await page.goto(base + '/admin/mindmaps'); await page.locator('#map-create').click(); await page.locator('#map-status').waitFor({ state: 'visible' });
  await page.locator('#map-title').fill('验收示例 · 本批创建流程'); await page.locator('#map-create').click(); await page.waitForURL(/\/admin\/mindmaps\//);
  await page.locator('[data-map-canvas] svg').first().waitFor();
  const createdPath = new URL(page.url()).pathname;
  const titleSaved = page.waitForResponse(response => response.url().endsWith(createdPath.replace('/admin','/api')) && response.request().method() === 'PUT');
  await page.locator('#map-title').fill('验收示例 · 修改标题'); await titleSaved;
  const exportReady = page.waitForEvent('download'); await page.locator('#map-export-svg').click();
  const exported = await exportReady; await exported.saveAs(path.join(out, 'map-export.svg'));
  assert.match(fs.readFileSync(path.join(out, 'map-export.svg'), 'utf8'), /<svg/);
  for (const type of ['png', 'md']) {
    const ready = page.waitForEvent('download'); await page.locator('#map-export-' + type).click();
    const download = await ready; const target = path.join(out, 'map-export.' + type); await download.saveAs(target);
    const content = fs.readFileSync(target);
    if (type === 'png') assert.equal(content.subarray(1,4).toString(), 'PNG');
    else assert.match(content.toString(), /验收示例/);
  }
  await page.goto(base + '/admin/mindmaps');
  const createdRow = page.locator('li').filter({ has: page.locator(`a[href="${createdPath}"]`) });
  await createdRow.locator('[data-map-del]').click(); await page.locator('.neo-confirm-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); await page.locator('.neo-confirm-dialog').waitFor({ state: 'hidden' });
  await createdRow.locator('[data-map-del]').click(); await page.locator('[data-confirm-ok]').click(); await createdRow.waitFor({ state: 'detached' });
  report.interactions.push('导图标题校验、创建、编辑、SVG/PNG/Markdown 实际导出、取消删除及副本删除');
  await mockNetdisk(page); await page.goto(base + '/admin/netdisk');
  await page.locator('[data-nd-toggle][title="验收文件夹"]').click(); await page.getByText('学习笔记.md', { exact: true }).waitFor();
  await page.locator('#nd-collapse').click(); await page.getByText('学习笔记.md', { exact: true }).waitFor({ state: 'hidden' });
  await page.locator('#nd-refresh').click(); await page.locator('[data-nd-toggle][title="验收文件夹"]').waitFor();
  report.interactions.push('网盘懒加载、折叠和刷新（隔离服务响应）');
  await page.goto(base + '/admin/auth');
  const applications = page.locator('[data-app-id]'); assert.ok(await applications.count() >= 2);
  const row = page.locator('[data-app-id="completion-app-0"]'), other = page.locator('[data-app-id="completion-app-1"]');
  await row.locator('[data-app-perm="articles"]').check(); await other.locator('[data-app-perm="nav"]').check();
  await row.locator('[data-action="approve"]').click(); await row.waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-app-id="completion-app-1"] [data-app-perm="nav"]').isChecked(), true);
  assert.ok(await page.locator('[data-acc-id]').filter({ hasText: 'review-app-0' }).count());
  report.interactions.push('副本审批权限及其他申请未保存勾选保留');
  await page.locator('#profile-btn').click(); await page.locator('#profile-dialog').waitFor({ state: 'visible' }); await page.locator('#profile-edit-btn').click(); await page.locator('#profile-nickname').waitFor({ state: 'visible' });
  await page.locator('#profile-cancel').click(); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'profile-btn');
  report.interactions.push('个人中心查看、编辑取消、Esc 及焦点恢复');
  await context.close();
  for (const uid of ['', 'completion-visitor', 'completion-admin']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); if (uid) await ctx.addCookies([userCookie(uid)]);
    const p = await ctx.newPage(); await p.goto(base + '/manage');
    assert.equal(await p.locator('h1').count(), 1); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (uid === 'completion-visitor') assert.ok(await p.locator('#apply-admin-btn').count());
    if (uid === 'completion-admin') assert.ok((await p.locator('h1').innerText()).includes('无权'));
    if (!uid) assert.ok(await p.locator('#top-login-form').count());
    await p.screenshot({ path: path.join(out, 'manage-' + (uid || 'guest') + '-390.png') });
    await p.goto(base + '/quick-notes'); assert.ok(new URL(p.url()).pathname === '/login');
    await p.goto(base + '/admin/auth'); assert.equal(await p.locator('#acc-add-btn').count(), 0);
    report.interactions.push('管理入口及受限页面身份：' + (uid || 'guest')); await ctx.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); await browser.close();
}
console.log(`COMPLETION_OK layouts=${report.layouts.length} interactions=${report.interactions.length}`);
