/** Uses the actual desktop main/preload and isolated database, registry and AI. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { _electron } from 'playwright-core';
const run = Date.now();
const root = process.cwd(), out = path.join(root, 'outputs/toolchain-desktop-review'), wrapper = path.join(out, 'wrapper'), appData = path.join(out, `appdata-${run}`), profile = path.join(out, `profile-${run}`), project = path.join(out, 'sample-project');
for (const directory of [out, wrapper, path.join(appData, 'byqx-blog-desktop'), profile, project]) fs.mkdirSync(directory, { recursive: true });
const dbPath = path.join(out, 'test.db');
if (!fs.existsSync(dbPath)) { const original = new Database('outputs/ai-review/preview.db', { readonly: true }); try { await original.backup(dbPath); } finally { original.close(); } }
const db = new Database(dbPath); try { db.prepare("DELETE FROM settings WHERE key IN ('ai_config','image_bed','netdisk')").run(); } finally { db.close(); }
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({ LOCAL_DB_PATH: dbPath, ADMIN_PASSWORD: 'toolchain-local-review-only', AUTH_SECRET: 'toolchain-isolated-local-review-secret', SYNC_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/isolated', PORT: String(port) }));
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({ name: 'toolchain-desktop-review', version: '1.1.3', main: 'main.cjs' }));
fs.writeFileSync(path.join(wrapper, 'main.cjs'), `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});if(process.env.BYQX_TOOLCHAIN_PREVIEW==='1')app.on('browser-window-created',(_event,win)=>win.on('page-title-updated',event=>{event.preventDefault();win.setTitle('工具链 · 隔离预览')}));`);
fs.writeFileSync(path.join(out, 'preview-info.json'), JSON.stringify({ appData, profile, port, isolated: true }, null, 2));
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'markdown-review', scripts: { start: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'server.cjs'), `require('http').createServer((q,s)=>s.end('<!doctype html><meta charset="utf-8"><title>隔离工具预览</title><h1>隔离工具</h1>')).listen(53991,'127.0.0.1');`);
fs.writeFileSync(path.join(project, 'README.md'), '# 启动\nnpm run start\n访问 http://127.0.0.1:53991，仅用于隔离验收。');
fs.writeFileSync(path.join(project, 'shortcut-target.cjs'), `require('fs').writeFileSync(${JSON.stringify(path.join(out, 'shortcut-opened'))},'opened')`);
if (fs.existsSync(path.join(out, 'shortcut-opened'))) fs.unlinkSync(path.join(out, 'shortcut-opened'));
const shortcut = path.join(out, '快捷方式验收.lnk');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)});$s.TargetPath=${quote(process.execPath)};$s.Arguments=${quote('"' + path.join(project, 'shortcut-target.cjs') + '"')};$s.WorkingDirectory=${quote(project)};$s.Save()`], { windowsHide: true });
const env = { ...process.env, BYQX_START_PATH: '/toolchain', BYQX_PI_AUTH_PATH: path.join(out, 'isolated-pi.json'), BYQX_CONFIG_PATH: path.join(out, 'isolated-ai.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' }; delete env.ELECTRON_RUN_AS_NODE;
const report = { cases: [], errors: [] };
const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [wrapper], env, timeout: 60000 });
try {
  const page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForURL(`http://127.0.0.1:${port}/login?**`, { timeout: 60000 });
  const visitor = await page.evaluate(async () => ({ api: (await fetch('/api/toolchain/access')).status, ipc: await window.desktop.toolchain('list'), fakeDrop: await window.desktop.dropToolchainSoftware(new File(['fake'], 'fake.exe')) }));
  assert.equal(visitor.api, 403); assert.equal(visitor.ipc.ok, false); assert.equal(visitor.fakeDrop.ok, false); report.cases.push('visitor HTTP/native controls denied; fake File cannot provide a path');
  await page.evaluate(async () => { const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'toolchain-local-review-only' }) }); if (!response.ok) throw Error('login failed'); });
  await page.goto(`http://127.0.0.1:${port}/toolchain`); await page.getByRole('button', { name: '添加工具', exact: true }).waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes('正在读取本机工具'));
  assert.equal(await page.locator('a[href="/quick-notes"] + a[href="/toolchain"]').count(), 1); report.cases.push('owner navigation entry immediately follows quick notes');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 200, y: 350, data: { items: [], files: [shortcut], dragOperationsMask: 1 } });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: 200, y: 350, data: { items: [], files: [shortcut], dragOperationsMask: 1 } });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: 200, y: 350, data: { items: [], files: [shortcut], dragOperationsMask: 1 } });
  const form = page.locator('.tc-dialog[open]'); await form.getByLabel('名称', { exact: true }).waitFor();
  await form.getByLabel('名称', { exact: true }).fill('快捷方式验收'); await form.getByLabel('分类', { exact: true }).fill('开发'); await form.getByRole('button', { name: '保存工具', exact: true }).click();
  await page.locator('.tc-card').filter({ hasText: '快捷方式验收' }).waitFor(); report.cases.push('real native file drag → webUtils path → preview → saved card');
  await page.locator('.tc-card').filter({ hasText: '快捷方式验收' }).getByRole('button', { name: '打开', exact: true }).click();
  for (let i = 0; i < 40 && !fs.existsSync(path.join(out, 'shortcut-opened')); i++) await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(fs.existsSync(path.join(out, 'shortcut-opened')), true); report.cases.push('original .lnk args and working directory launch successfully');
  await page.getByRole('button', { name: '添加工具', exact: true }).click(); await form.getByRole('button', { name: '源码项目', exact: true }).click();
  await form.getByLabel('文件夹位置', { exact: true }).fill(project); await form.getByRole('button', { name: '重新读取项目', exact: true }).click();
  await form.getByLabel('名称', { exact: true }).fill('Markdown 文本工具'); await form.getByLabel('启动命令', { exact: true }).fill('npm run start'); await form.getByLabel('工具本机地址', { exact: true }).fill('http://127.0.0.1:53991');
  await form.getByRole('button', { name: '让博客 AI 分析启动方式' }).click(); await form.getByRole('alert').filter({ hasText: '博客 AI 尚未就绪' }).waitFor();
  assert.equal(await form.getByLabel('启动命令', { exact: true }).inputValue(), 'npm run start'); report.cases.push('metadata/environment detection and AI-unavailable fallback preserve manual input');
  await form.getByRole('button', { name: '保存工具', exact: true }).click();
  await page.getByRole('button', { name: '添加工具', exact: true }).click(); await form.getByRole('button', { name: '网页工具', exact: true }).click();
  await form.getByLabel('名称', { exact: true }).fill('Cloudflare 文档'); await form.getByLabel('网页地址').fill('https://developers.cloudflare.com/workers-ai/'); await form.getByRole('button', { name: '保存工具', exact: true }).click();
  await page.locator('.tc-card').filter({ hasText: 'Cloudflare 文档' }).waitFor();
  const sourceCard = page.locator('.tc-card').filter({ hasText: 'Markdown 文本工具' }); await sourceCard.getByRole('button', { name: '收藏Markdown 文本工具' }).click();
  await sourceCard.getByRole('button', { name: '取消收藏Markdown 文本工具' }).waitFor();
  await page.getByRole('button', { name: '收藏', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.tc-card').length === 1); assert.equal(await page.locator('.tc-card').count(), 1); await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索工具' }).fill('Cloudflare'); await page.waitForFunction(() => document.querySelectorAll('.tc-card').length === 1); assert.equal(await page.locator('.tc-card').count(), 1); await page.getByRole('searchbox', { name: '搜索工具' }).fill(''); report.cases.push('web registration, favorites and search');
  await sourceCard.click({ button: 'right' }); await page.getByRole('menuitem', { name: '打开当前项目文件夹' }).waitFor(); await page.keyboard.press('Escape');
  await sourceCard.focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('menuitem', { name: '查看日志' }).click(); await page.locator('.tc-log-dialog[open]').waitFor(); await page.keyboard.press('Escape'); report.cases.push('mouse/keyboard context menus and log dialog');
  for (const width of [1440, 1280, 941, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1050 }); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `overflow at ${width}`);
    await page.screenshot({ path: path.join(out, `light-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.add('dark')); await page.screenshot({ path: path.join(out, 'dark-360.png'), fullPage: true }); report.cases.push('six viewport sizes + dark mode without horizontal overflow');
  assert.deepEqual(report.errors, []); console.log('TOOLCHAIN_DESKTOP_UI_OK', report.cases.length);
} catch (error) { report.errors.push(error.stack); throw error; }
finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await app.close().catch(() => {}); }
