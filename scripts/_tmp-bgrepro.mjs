/**
 * 复现：保存背景配置后，打开设置页检查回显
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
await ctx.request.post('http://localhost:4325/api/login', { data: { password: 'dev-admin-password' } });

const put = await ctx.request.put('http://localhost:4325/api/background', {
  data: { enabled: true, imageUrl: '/api/images/test-bg', opacity: 65, blur: 14 },
});
console.log('PUT: ' + put.status() + ' ' + (await put.text()).slice(0, 100));

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('C: ' + m.text().slice(0, 120)); });

await page.goto('http://localhost:4325/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const state = await page.evaluate(() => {
  const sec = document.getElementById('site-background');
  const enabled = document.getElementById('bg-enabled');
  const opacity = document.getElementById('bg-opacity');
  const blur = document.getElementById('bg-blur');
  const opacityVal = document.getElementById('bg-opacity-val');
  return {
    dataBg: sec?.dataset.bg ?? 'NO SECTION',
    checked: enabled ? enabled.checked : null,
    opacityValue: opacity ? opacity.value : null,
    blurValue: blur ? blur.value : null,
    opacityLabel: opacityVal ? opacityVal.textContent : null,
    hasSaveBtn: !!document.getElementById('bg-save'),
  };
});
console.log('STATE: ' + JSON.stringify(state, null, 2));
console.log('ERRORS: ' + JSON.stringify(errors));
await browser.close();
