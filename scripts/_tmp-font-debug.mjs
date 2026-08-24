/**
 * 排查设置页字体上传：脚本错误 + 上传按钮事件绑定 + 点击反馈
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let executablePath = null;
for (const p of [EDGE, CHROME]) {
  if (fs.existsSync(p)) { executablePath = p; break; }
}

const browser = await chromium.launch({ executablePath, headless: true });
const ctx = await browser.newContext();
const base = 'http://localhost:4325';
const login = await ctx.request.post(base + '/api/login', { data: { password: 'dev-admin-password' } });
const m = (login.headers()['set-cookie'] ?? '').match(/admin_session=([^;]+)/);
await ctx.addCookies([{ name: 'admin_session', value: m?.[1] ?? '', url: base }]);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text().slice(0, 200)); });

await page.goto(base + '/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 检查元素存在 + 点击"上传"（未选文件应提示）
const before = await page.evaluate(() => ({
  hasUploadBtn: !!document.getElementById('font-upload'),
  hasChooseBtn: !!document.getElementById('font-choose'),
  hasFile: !!document.getElementById('font-file'),
  hasName: !!document.getElementById('font-name'),
  hasStatus: !!document.getElementById('font-status'),
  fontListHtml: (document.getElementById('font-list')?.textContent ?? '').slice(0, 80),
}));
console.log('元素: ' + JSON.stringify(before));

// 点击上传（未选文件）
await page.click('#font-upload');
await page.waitForTimeout(300);
const afterClick = await page.evaluate(() => {
  const s = document.getElementById('font-status');
  return { statusText: s?.textContent ?? null, visible: s ? !s.classList.contains('hidden') : false };
});
console.log('点击后(无文件): ' + JSON.stringify(afterClick));
console.log('ERRORS: ' + JSON.stringify(errors, null, 2));

await browser.close();
