import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/ai-review');
const base = 'http://127.0.0.1:43232';
const db = new Database(path.join(out, 'preview.db'));
const saved = db.prepare("SELECT * FROM settings WHERE key='ai_config'").get();
const article = db.prepare('SELECT id,content FROM articles WHERE encrypted=0 ORDER BY length(content) ASC LIMIT 1').get();
const beforeContent = db.prepare('SELECT id,content,cover,title FROM articles ORDER BY id').all();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
try {
  const guest = await browser.newContext();
  for (const endpoint of ['/api/ai/subscription', '/api/ai/cover']) {
    const response = await guest.request.fetch(base + endpoint, { method: endpoint.endsWith('cover') ? 'POST' : 'GET', data: endpoint.endsWith('cover') ? { id: article.id } : undefined });
    assert([401,403].includes(response.status())); checks.push(`guest denied ${endpoint}`);
  }
  await guest.close();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const login = await context.request.post(base + '/api/admin-auth/login', { data: { password: 'article-review-local' } }); assert(login.ok());
  // Production cookies are Secure; this isolated HTTP test mirrors prior review runners.
  await context.addCookies((await context.cookies()).map(cookie => ({ ...cookie, secure: false })));
  const old = { enabled: true, connectionMode: 'api', baseUrl: 'https://isolated.invalid/v1', apiKey: 'isolated-test-key', model: 'isolated-model', systemPrompt: '保留原有提示词', allowGuests: false };
  const configResponse = await context.request.put(base + '/api/ai/config', { data: old });
  assert(configResponse.ok(), `${configResponse.status()} ${await configResponse.text()}`);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  // The real account catalog requires human sign-in. Only this UI choice is mocked.
  await page.route('**/api/ai/subscription', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const status = await response.json();
    if (status.providers) status.providers.find(p => p.id === 'openai').models = [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol（界面验收）' }];
    await route.fulfill({ response, json: status });
  });
  await page.goto(base + '/admin/settings/ai');
  await page.locator('#ai-connection-mode').selectOption('subscription');
  await page.waitForFunction(() => document.querySelector('#ai-subscription-model option[value=""]'));
  const choices = await page.locator('#ai-subscription-model option').evaluateAll(options => options.map(o => o.value).filter(Boolean)); assert(choices.length > 0);
  await page.locator('#ai-subscription-model').selectOption(choices[0]);
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/api/ai/config') && r.request().method() === 'PUT');
  await page.locator('#ai-save').click(); assert((await savedResponse).ok());
  await page.reload(); await page.locator('#ai-connection-mode').waitFor();
  assert.equal(await page.locator('#ai-connection-mode').inputValue(), 'subscription');
  assert.equal(await page.locator('#ai-sysprompt').inputValue(), old.systemPrompt);
  assert.equal(await page.locator('#ai-baseurl').inputValue(), old.baseUrl);
  const cfg = await (await context.request.get(base + '/api/ai/config')).json();
  assert(cfg.hasApiKey && !('apiKey' in cfg)); checks.push('mode and model persisted; API URL/key and system prompt preserved');
  for (const [width, dark] of [[1440,false],[941,false],[390,false],[360,true]]) {
    await page.setViewportSize({ width, height: 1000 });
    if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('[data-ai-subscription]').screenshot({ path: path.join(out, `settings-${width}-${dark ? 'dark' : 'light'}.png`) });
    checks.push(`settings ${width}px ${dark ? 'dark' : 'light'} no overflow`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: '订阅登录', exact: true }).first().click();
  await page.getByRole('link', { name: '打开官方授权页面' }).waitFor();
  const href = await page.getByRole('link', { name: '打开官方授权页面' }).getAttribute('href');
  assert.equal(new URL(href).origin, 'https://auth.openai.com');
  const callback = new URL(new URL(href).searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1'); assert.notEqual(callback.port, '1455');
  await page.getByRole('button', { name: '取消登录', exact: true }).click();
  await page.getByText('登录已取消或超时', { exact: true }).waitFor();
  checks.push('actual OAuth URL, dynamic loopback listener and cancellation');
  await page.locator('#ai-test').click();
  await page.getByText('请先在 AI 助手设置中登录订阅账号', { exact: true }).waitFor();
  checks.push('unconnected subscription produces clear connection-test feedback');
  await page.goto(base + `/edit/${article.id}`);
  const pdf = page.getByRole('button', { name: /导出 PDF/ }).first();
  const cover = page.getByRole('button', { name: 'AI 生成封面', exact: true });
  await cover.waitFor();
  const [a,b] = await Promise.all([pdf.boundingBox(), cover.boundingBox()]);
  assert(a && b && b.x >= a.x + a.width - 1); checks.push('cover button placed after PDF export');
  await cover.click();
  await page.getByText('请先配置 GitHub 图床或 R2，再生成封面', { exact: true }).waitFor();
  checks.push('cover checks storage before paid generation');
  await page.keyboard.press('Escape');
  assert(await cover.evaluate(el => document.activeElement === el)); checks.push('cover dialog Escape and focus restore');
  await page.locator('#doc-inline-edit').click();
  await page.locator('.cm-editor').first().waitFor();
  await page.locator('#rt-ai').click();
  await page.getByRole('dialog', { name: 'AI 文章助手' }).waitFor();
  assert(await page.getByRole('combobox', { name: '整理技能' }).isVisible());
  await page.getByRole('combobox', { name: '整理技能' }).selectOption('note-normalizer');
  await page.getByRole('dialog', { name: 'AI 文章助手' }).screenshot({ path: path.join(out, 'article-skill-editor.png') });
  checks.push('existing article skill editor remains available');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push('390px article editing no overflow');
  assert.deepEqual(db.prepare('SELECT id,content,cover,title FROM articles ORDER BY id').all(), beforeContent); checks.push('all article content, titles and covers unchanged');
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify({ checks, errors, actualSubscriptionInference: 'requires user login', actualImageGeneration: 'not invoked' }, null, 2));
  console.log(`AI_BROWSER_PASS ${checks.length} checks`);
} finally {
  await browser.close();
  if (saved) db.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='ai_config'").run(saved.value, saved.updated_at);
  else db.prepare("DELETE FROM settings WHERE key='ai_config'").run();
  db.close();
  const localAuth = path.join(out, 'pi-auth.json');
  if (fs.existsSync(localAuth)) {
    const auth = JSON.parse(fs.readFileSync(localAuth, 'utf8'));
    assert.equal(Object.keys(auth.credentials || {}).length, 0); fs.unlinkSync(localAuth);
  }
}
