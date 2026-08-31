/**
 * 复现脚本：/edit/[id] 编辑器「点不进光标」
 * 检查：编辑器是否水合、是否被遮挡、点击落点、控制台错误
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:4321';
const EDIT_URL = `${BASE}/edit/3cc61793-a9f0-482c-a8f6-4f2cfe9a4ab1`;

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 300)));

// 登录
const login = await ctx.request.post(`${BASE}/api/login`, { data: { password: 'dev-admin-password' } });
console.log('login status:', login.status());
const cookies = await ctx.cookies();
console.log('cookies:', cookies.map((c) => `${c.name}=${c.value.slice(0, 12)}...`).join(', '));

// 打开编辑页
await page.goto(EDIT_URL, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message));
await page.waitForTimeout(2000);
console.log('final url:', page.url());

// 检查编辑器
const info = await page.evaluate(() => {
  const cm = document.querySelector('.cm-content');
  if (!cm) {
    return { cm: false, bodySnippet: document.body.innerHTML.slice(0, 400) };
  }
  const r = cm.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
  const describe = (e) =>
    e
      ? {
          tag: e.tagName,
          id: e.id || undefined,
          cls: (e.className || '').toString().slice(0, 140),
          position: getComputedStyle(e).position,
          pointerEvents: getComputedStyle(e).pointerEvents,
          zIndex: getComputedStyle(e).zIndex,
          rect: (() => {
            const b = e.getBoundingClientRect();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
          })(),
        }
      : null;
  return {
    cm: true,
    rect: (() => {
      const b = cm.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })(),
    contentEditable: cm.getAttribute('contenteditable'),
    hasText: cm.textContent.length,
    atPoint: describe(el),
    insideCm: el ? cm.contains(el) || el === cm : false,
  };
});
console.log('=== editor info ===');
console.log(JSON.stringify(info, null, 2));

// 尝试点击编辑器
try {
  await page.click('.cm-content', { position: { x: 60, y: 20 }, timeout: 5000 });
  console.log('click: OK');
} catch (e) {
  console.log('click FAILED:', e.message.split('\n').slice(0, 4).join(' | '));
}
await page.waitForTimeout(400);
const active = await page.evaluate(() => {
  const a = document.activeElement;
  return a ? { tag: a.tagName, id: a.id || undefined, cls: (a.className || '').toString().slice(0, 100) } : null;
});
console.log('activeElement after click:', JSON.stringify(active));

// 检查页面上覆盖视口中央的高层级元素
const overlays = await page.evaluate(() => {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    if (b.width < 50 || b.height < 50) continue;
    const coversCenter = b.left <= cx && b.top <= cy && b.right >= cx && b.bottom >= cy;
    if (coversCenter && (s.position === 'fixed' || Number(s.zIndex) >= 10)) {
      out.push({
        tag: e.tagName,
        id: e.id || undefined,
        cls: (e.className || '').toString().slice(0, 100),
        position: s.position,
        zIndex: s.zIndex,
        pointerEvents: s.pointerEvents,
        rect: { w: Math.round(b.width), h: Math.round(b.height) },
      });
    }
  }
  return out;
});
console.log('=== overlays covering viewport center (fixed / z>=10) ===');
console.log(JSON.stringify(overlays, null, 2));

console.log('=== console errors ===');
console.log(errors.length ? errors.slice(0, 10) : '(none)');
await browser.close();
