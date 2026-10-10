/** Confirm the new icon buttons still reach the existing management handlers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const base='http://127.0.0.1:43227',out=path.resolve('outputs/discovery-workspace');
const meta=JSON.parse(fs.readFileSync(path.join(out,'server.json'),'utf8'));
assert.equal(meta.databasePath,path.join(out,'test.db'));
const report={cases:[],errors:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(login.ok);const cookie=login.headers.get('set-cookie').split(';')[0];
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',extraHTTPHeaders:{origin:base}});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
  const created=await context.request.post(base+'/api/nav/categories',{data:{name:'验收示例 · 图标操作检查'}});assert.ok(created.ok());const id=(await created.json()).category.id;
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base+'/nav');await page.locator(`[data-cat-edit="${id}"]`).click();await page.getByRole('dialog',{name:'编辑分类',exact:true}).waitFor();
  await page.locator('#nav-cat-edit-name').fill('验收示例 · 已改名分类');await page.locator('#nav-cat-edit-confirm').click();await page.locator('#nav-cat-edit-dialog').waitFor({state:'hidden'});
  await page.locator(`[data-cat-tab="${id}"]`).filter({visible:true}).getByText('验收示例 · 已改名分类',{exact:true}).waitFor();
  await page.locator(`[data-drop-cat="${id}"]`).dragTo(page.locator('[data-drop-cat="review-dev"]'));
  await page.waitForFunction(id=>{const data=JSON.parse(document.getElementById('nav-data').dataset.categories);return data.findIndex(c=>c.id===id)<data.length-1;},id);
  await page.reload();await page.locator(`[data-cat-del="${id}"]`).click();await page.getByRole('dialog',{name:'操作确认',exact:true}).waitFor();await page.locator('[data-confirm-ok]').click();await page.locator(`[data-cat-tab="${id}"]`).first().waitFor({state:'detached'});
  await page.goto(base+'/admin/nav');
  const data=JSON.parse(await page.locator('#nav-data').getAttribute('data-categories'));const website=data.flatMap(c=>c.sites).find(s=>s.name==='验收示例 · 新网站');assert.ok(website);
  await page.locator(`[data-site-move="${website.id}"]`).selectOption('review-design');
  await page.waitForFunction(id=>JSON.parse(document.getElementById('nav-data').dataset.categories).find(c=>c.id==='review-design').sites.some(s=>s.id===id),website.id);
  await page.locator(`[data-site-del="${website.id}"]`).click();await page.getByRole('dialog',{name:'操作确认',exact:true}).waitFor();await page.locator('[data-confirm-ok]').click();await page.locator(`[data-site-del="${website.id}"]`).waitFor({state:'detached'});
  report.cases.push('Lucide category edit/delete buttons, persisted category drag ordering, admin website move and deletion on isolated fixture records');
  assert.deepEqual(report.errors,[]);await context.close();
} finally {fs.writeFileSync(path.join(out,'management-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log('Discovery management icons/order/move/delete passed');
