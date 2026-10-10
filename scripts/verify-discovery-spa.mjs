import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const base='http://127.0.0.1:43227',out=path.resolve('outputs/discovery-workspace');
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={cases:[],errors:[]};
try {
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(response.ok);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const context=await browser.newContext({viewport:{width:941,height:1000},reducedMotion:'reduce'});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base+'/nav');await page.locator('[data-cat-tab="review-dev"]').filter({visible:true}).click();
  for(let i=0;i<2;i++) {
    await page.locator('#site-header').getByRole('link',{name:'影集',exact:true}).click();await page.locator('#gallery-groups').waitFor();assert.equal(await page.locator('.photo-card').count(),30);
    await page.locator('[data-lightbox]').first().click();await page.getByRole('dialog',{name:'图片预览',exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.goBack();await page.locator('#nav-search').waitFor();assert.equal(await page.locator('#nav-title').textContent(),'验收示例 · 开发工具');
    await page.locator('#nav-search').fill('TypeScript');assert.equal(await page.locator('[data-cat-panel="review-dev"] [data-nav-search]:not([hidden])').count(),1);
    await page.getByRole('button',{name:'清除网站搜索',exact:true}).click();
  }
  await page.locator('[data-cat-add]').filter({visible:true}).first().click();await page.getByRole('dialog',{name:'添加分类',exact:true}).waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-cat-add]').filter({visible:true}).first().evaluate(e=>e===document.activeElement),true);
  report.cases.push('two ClientRouter nav/gallery round trips; history category restoration, search and lightbox still work; native dialog Esc returns focus');
  assert.deepEqual(report.errors,[]);await context.close();
} finally {fs.writeFileSync(path.join(out,'spa-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log('Discovery SPA/history/focus passed');
