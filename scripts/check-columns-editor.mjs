/** Standalone browser regression: pnpm exec node scripts/check-columns-editor.mjs */
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium browser executable');
const server = await createServer({ configFile: false, root, plugins: [tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 4329, strictPort: true }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /decoration|uncaught|rangeerror/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/api/editor-shortcuts', (route) => route.fulfill({ json: { bindings: {} } }));
  await page.goto('http://127.0.0.1:4329/tests/fixtures/columns-editor.html');
  await page.waitForFunction(() => window.columnHarness?.ready);
  const panes = page.locator('.cm-column-host .cm-content');
  await panes.nth(1).waitFor();
  const first = panes.nth(0);
  await first.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('连续输入');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('第二行');
  await page.waitForFunction(() => window.columnHarness.content.includes('连续输入\n第二行'));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => window.columnHarness.content.includes('第二行'));
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => window.columnHarness.saves), 1);

  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  await session.send('Input.insertText', { text: '中文' });
  await page.waitForFunction(() => window.columnHarness.content.includes('第二行中文'));

  await page.getByRole('button', { name: '添加一栏', exact: true }).click();
  assert.equal(await panes.count(), 3);
  await panes.nth(2).click();
  await page.keyboard.insertText('第三栏内容');
  await page.waitForFunction(() => window.columnHarness.content.includes('第三栏内容'));
  await page.getByRole('button', { name: '合并移除', exact: true }).nth(2).click();
  assert.equal(await panes.count(), 2);
  assert.match(await page.evaluate(() => window.columnHarness.content), /第三栏内容/);
  await page.getByRole('button', { name: '右移', exact: true }).first().click();
  assert.match(await panes.nth(1).innerText(), /第二行中文/);

  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  assert.equal(await panes.count(), 0);
  await page.getByRole('button', { name: '恢复分栏视图', exact: true }).click();
  assert.equal(await panes.count(), 2);
  const output = path.join(root, 'outputs/columns-editor');
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.screenshot({ path: path.join(output, 'narrow.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow viewport must not overflow');

  await page.goto('http://127.0.0.1:4329/tests/fixtures/columns-editor.html?panel');
  await page.waitForFunction(() => window.columnHarness?.ready);
  await panes.nth(0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('格式目标');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '加粗（Ctrl/Cmd+B）', exact: true }).click();
  await page.waitForFunction(() => window.columnHarness.content.includes('**格式目标**'));
  assert.equal(await panes.count(), 2);
  await page.getByRole('button', { name: '两栏', exact: true }).click();
  await page.waitForFunction(() => !!document.activeElement?.closest('.cm-column-host'));
  await page.keyboard.insertText('新组自动聚焦');
  await page.waitForFunction(() => window.columnHarness.content.includes('新组自动聚焦'));
  assert.equal(await panes.count(), 4);

  await page.goto('http://127.0.0.1:4329/tests/fixtures/columns-editor.html?manual');
  await page.waitForFunction(() => window.columnHarness?.ready);
  await panes.nth(0).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('新行');
  await page.waitForFunction(() => window.columnHarness.content.includes('手写内容\n新行'));
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('```ts');
  await page.keyboard.press('Enter');
  assert.equal(await panes.count(), 2, 'An unfinished code fence must not dismantle the active column');
  await page.keyboard.insertText('const value = 1;');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('```');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(':::note');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('嵌套内容');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(':::');
  await page.waitForFunction(() => window.columnHarness.content.includes('::::columns'));
  assert.equal(await panes.count(), 2);

  await page.goto('http://127.0.0.1:4329/tests/fixtures/columns-editor.html?rich');
  await page.waitForFunction(() => window.columnHarness?.ready);
  assert.ok(await page.locator('.cm-column-host .katex').count());
  const cell = page.locator('.cm-column-host td').nth(2);
  await cell.fill('表格未失焦文字');
  await page.getByRole('button', { name: '展开为普通正文', exact: true }).click();
  await page.waitForFunction(() => window.columnHarness.content.includes('表格未失焦文字'));
  assert.equal(await panes.count(), 0);

  await page.goto('http://127.0.0.1:4329/tests/fixtures/columns-editor.html?large&light');
  await page.waitForFunction(() => window.columnHarness?.ready);
  await panes.nth(0).click();
  await page.keyboard.press('Control+End');
  const began = performance.now();
  await page.keyboard.type('12345678901234567890');
  await page.waitForFunction(() => window.columnHarness.content.includes('12345678901234567890'));
  console.log(`Large-document input: 20 keys ${(performance.now() - began).toFixed(0)}ms wall time (includes browser automation)`);
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log('PASS: column typing, newline, undo/redo, IME, save, merge, move, source toggle, narrow layout, toolbar targeting');
} finally {
  await browser?.close();
  await server.close();
}
