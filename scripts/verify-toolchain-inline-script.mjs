/**
 * 便携版验收：工具链「直接粘贴脚本代码」。
 *
 * 用 release/portable 里的真实 exe 走完整链路：登记 → 卡片 → 启动 → 落地 inline.ps1 →
 * PowerShell 执行 → 退出码与日志，全程使用隔离的 appData / 数据库 / 端口，不碰正式数据。
 * 运行：node scripts/verify-toolchain-inline-script.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { _electron } from 'playwright-core';

const root = process.cwd();
const portable = path.join(root, 'release/portable');
const executable = path.join(portable, '白衣卿相.exe');
const packaged = path.join(portable, 'resources/app/desktop');
const out = path.join(root, 'outputs/toolchain-inline-review', String(Date.now()));
const appData = path.join(out, 'appdata');
const profile = path.join(out, 'profile');
const toolDir = path.join(appData, 'byqx-blog-desktop');
for (const directory of [out, profile, toolDir]) fs.mkdirSync(directory, { recursive: true });
const report = { executable, cases: [], errors: [] };
const record = message => { report.cases.push(message); console.log(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

assert.ok(fs.existsSync(executable), `未找到便携版：${executable}，请先运行 pnpm build:portable`);
// 先证明产物里就是本次源码，避免"验收的是旧包"。
for (const file of ['toolchain/core.cjs', 'toolchain/manager.cjs']) assert.equal(digest(path.join(root, 'desktop', file)), digest(path.join(packaged, file)), file);
record('便携版中的 core.cjs / manager.cjs 与源码一致');

const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const port = await freePort();
const dbPath = path.join(out, 'test.db');
const template = path.join(root, 'outputs/toolchain-desktop-review/test.db');
assert.ok(fs.existsSync(template), `缺少隔离数据库模板：${template}`);
const source = new Database(template, { readonly: true });
try { await source.backup(dbPath); } finally { source.close(); }
fs.writeFileSync(path.join(toolDir, 'config.json'), JSON.stringify({ LOCAL_DB_PATH: dbPath, ADMIN_PASSWORD: 'inline-isolated-review-only', AUTH_SECRET: 'inline-isolated-review-secret', SYNC_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/isolated', PORT: String(port) }));
// 该入口先设隔离路径，再运行打包后的原始主进程。
const bootstrap = path.join(out, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(path.join(packaged, 'main.cjs'))};delete require.cache[require.resolve(main)];require(main);`);
const env = { ...process.env, BYQX_START_PATH: '/toolchain', BYQX_PI_AUTH_PATH: path.join(out, 'pi.json'), BYQX_CONFIG_PATH: path.join(out, 'ai.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' };
delete env.ELECTRON_RUN_AS_NODE;

const code = ['# 粘贴代码验收', '$name = "白衣卿相"', 'Write-Output "INLINE_VERIFY_OK $name"', 'Write-Output "中文输出：你好，世界"'].join('\n');
let app, entry, stateFile, state;
const invoke = (page, action, input = {}) => page.evaluate(async ({ action, input }) => { const result = await window.desktop.toolchain(action, input); if (!result.ok) throw Error(result.error); return result.data; }, { action, input });

try {
  app = await _electron.launch({ executablePath: executable, args: ['--toolchain-runner', bootstrap], env, cwd: out, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForURL(`http://127.0.0.1:${port}/login?**`, { timeout: 60000 });
  await page.evaluate(async () => { const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'inline-isolated-review-only' }) }); if (!response.ok) throw Error('隔离登录失败'); });
  await page.goto(`http://127.0.0.1:${port}/toolchain`);
  await page.getByRole('button', { name: '添加工具', exact: true }).waitFor();
  record('便携版在源码目录之外启动，站主可进入工具链');

  // 页面上还有一个日志弹窗同样是 .tc-dialog，用无障碍名称精确定位表单。
  const form = page.getByRole('dialog', { name: '添加工具' });
  await page.getByRole('button', { name: '添加工具', exact: true }).click();
  await form.waitFor();
  await form.getByRole('button', { name: '脚本启动', exact: true }).click();
  // 来源切换到「直接粘贴脚本代码」：选择文件按钮必须消失，代码框必须出现。
  await form.getByRole('button', { name: '直接粘贴脚本代码', exact: true }).click();
  assert.equal(await form.locator('.tc-picker').count(), 0, '粘贴模式仍显示文件选择器');
  const textarea = form.locator('textarea');
  await textarea.waitFor();
  await form.getByLabel('名称').fill('粘贴代码验收');
  await textarea.fill(code);
  assert.match(await form.locator('#tc-code-help').innerText(), /4 行/, '行数统计不正确');
  record('表单提供「脚本启动 → 直接粘贴脚本代码」，文件选择器让位给代码框');

  await form.getByRole('button', { name: '保存工具', exact: true }).click();
  await form.waitFor({ state: 'hidden', timeout: 30000 });
  const card = page.locator('article.tc-card', { hasText: '粘贴代码验收' });
  await card.waitFor({ timeout: 30000 });
  assert.match(await card.innerText(), /直接粘贴的脚本 · 4 行/);
  record('保存后生成卡片，显示「直接粘贴的脚本 · 4 行」');

  // 登记项里保留代码本身，不产生用户源文件。
  const listed = await invoke(page, 'list');
  entry = listed.find(item => item.name === '粘贴代码验收');
  assert.ok(entry, '登记项不存在');
  assert.equal(entry.mode, 'inline');
  assert.equal(entry.path, undefined);
  assert.equal(entry.code, code);
  record('登记表保存代码本身，mode=inline 且没有 path');

  await card.getByRole('button', { name: '启动脚本', exact: true }).click();
  const runDir = path.join(toolDir, 'toolchain/runs', entry.id);
  stateFile = path.join(runDir, 'state.json');
  const inlineFile = path.join(runDir, 'inline.ps1');
  for (let i = 0; i < 150 && !fs.existsSync(inlineFile); i++) await delay(100);
  assert.ok(fs.existsSync(inlineFile), '启动后没有生成 inline.ps1');
  const bytes = fs.readFileSync(inlineFile);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'inline.ps1 缺少 UTF-8 BOM');
  assert.equal(bytes.subarray(3).toString('utf8'), code);
  record('启动时把粘贴代码写成带 BOM 的 runs/<id>/inline.ps1');

  for (let i = 0; i < 200; i++) { try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {} if (['stopped', 'failed'].includes(state?.status)) break; await delay(200); }
  assert.equal(state?.status, 'stopped', `脚本未正常结束：${state?.error || ''}`);
  assert.equal(state?.exitCode, 0);
  record('PowerShell 执行粘贴脚本并以退出码 0 结束');

  const logs = await invoke(page, 'logs', { id: entry.id });
  assert.match(logs, /INLINE_VERIFY_OK 白衣卿相/, '日志缺少脚本输出');
  assert.match(logs, /中文输出：你好，世界/, '日志中的中文出现乱码');
  record('日志完整捕获脚本输出，中文未乱码');

  await page.screenshot({ path: path.join(out, 'inline-script-card.png'), fullPage: true });
  await invoke(page, 'remove', { id: entry.id });
  assert.equal((await invoke(page, 'list')).length, 0);
  record('移除入口后登记表为空');
  console.log('TOOLCHAIN_INLINE_OK', report.cases.length);
  await app.close();
  app = undefined;
} catch (error) {
  report.errors.push(error.stack);
  if (app) { try { await page_safe_screenshot(app, out); } catch {} }
  throw error;
} finally {
  await app?.close().catch(() => {});
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'outputs/toolchain-inline-review/latest.json'), JSON.stringify({ out, ...report }, null, 2));
}

async function page_safe_screenshot(instance, directory) {
  const [window] = instance.windows();
  if (window) await window.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true });
}
