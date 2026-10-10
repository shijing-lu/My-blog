/** Final UI polish regression after removing the redundant schedule footer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out = path.resolve('outputs/schedule-workspace');
const base = 'http://127.0.0.1:43226';
const routes = ['/schedule', '/schedule/plans', '/schedule/schedule', '/schedule/execute', '/schedule/review', '/schedule/todos', '/schedule/stats', '/schedule/settings', '/calendar'];
const fixture = JSON.parse(fs.readFileSync(path.join(out, 'acceptance-export.json'), 'utf8')).data;
const report = { layouts: [], errors: [] };
const browser = await chromium.launch({channel: 'msedge', headless: true});
try {
  const login = await fetch(base + '/api/login', {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({password:'article-review-local'})});
  assert.ok(login.ok);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
    await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
    await context.addInitScript(mode => localStorage.setItem('my-blog-theme',JSON.stringify({mode})),mode);
    const page = await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base + '/schedule');
    await page.locator('.cadence-shell h1').waitFor();
    if (mode === 'light') {
      for (const route of ['/schedule','/schedule/plans','/schedule/stats']) {
        await page.goto(base + route);
        await page.locator('.cadence-shell h1').waitFor();
        await page.evaluate(()=>document.fonts.ready);
        await page.waitForTimeout(300);
        await page.screenshot({path:path.join(out,'empty-'+route.slice(1).replaceAll('/','-')+'-1280.png')});
      }
    }
    await page.evaluate(data => new Promise((resolve,reject)=>{
      const request=indexedDB.open('byqx-cadence');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const names=Object.keys(data).filter(name=>db.objectStoreNames.contains(name));
        const tx=db.transaction(names,'readwrite');
        for(const name of names) for(const row of data[name]) tx.objectStore(name).put(row);
        tx.oncomplete=()=>{db.close();resolve();};
        tx.onerror=()=>reject(tx.error);
      };
    }),fixture);
    for (const width of mode === 'light' ? [941,390] : [1280]) {
      await page.setViewportSize({width,height:1000});
      for (const route of mode === 'light' ? routes : ['/schedule/schedule','/calendar']) {
        await page.goto(base + route);
        if(route.startsWith('/schedule')) await page.locator('.cadence-shell h1').waitFor();
        await page.evaluate(()=>document.fonts.ready);
        await page.waitForTimeout(300);
        const metrics = await page.evaluate(()=>({
          overflow:document.documentElement.scrollWidth-innerWidth,
          headings:document.querySelectorAll('h1').length,
          footers:document.querySelectorAll('footer').length,
          cats:document.querySelectorAll('#site-footer img[src="/images/neobrutalism/cat-rest.webp"]').length,
          dark:document.documentElement.classList.contains('dark'),
        }));
        assert.ok(metrics.overflow<=1,route+' '+width+' overflow');
        assert.equal(metrics.headings,1); assert.equal(metrics.footers,1); assert.equal(metrics.cats,1); assert.equal(metrics.dark,mode==='dark');
        report.layouts.push({route,width,mode,...metrics});
        await page.screenshot({path:path.join(out,route.slice(1).replaceAll('/','-')+'-'+width+'-'+mode+'.png')});
      }
    }
    if(mode === 'light') {
      await page.goto(base+'/schedule'); await page.locator('.cadence-shell h1').waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({path:path.join(out,'schedule-full-390-light.png'),fullPage:true});
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
} finally {
  fs.writeFileSync(path.join(out,'footer-polish-report.json'),JSON.stringify(report,null,2));
  await browser.close();
}
console.log('Final schedule polish passed: '+report.layouts.length+' layouts, one shared footer on each page');
