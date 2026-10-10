import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const out=path.resolve('outputs/discovery-workspace');
const meta=JSON.parse(fs.readFileSync(path.join(out,'server.json'),'utf8'));
assert.equal(meta.databasePath,path.join(out,'test.db'));assert.equal(meta.port,43227);
const base='http://127.0.0.1:43227';
const routes=['/nav','/admin/nav','/gallery','/gallery/upload'];
const report={layouts:[],dialogs:[],cases:[],errors:[],fixtures:'Copied SQLite; all seeded examples labelled acceptance fixtures. Storage writes mocked.'};
const browser=await chromium.launch({channel:'msedge',headless:true});
const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(login.ok);
const cookie=login.headers.get('set-cookie').split(';')[0];
let context,page;
const goto=async route=>{const response=await page.goto(base+route,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,route);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(280);};
const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png')});};
async function geometry(route,width,mode,owner) {
  const metrics=await page.evaluate(()=>{
    const root=document.querySelector('.neo-discovery');const bounds=root.getBoundingClientRect();
    const outside=[...root.querySelectorAll('input:not([type="hidden"]):not([type="file"]),select,textarea')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})).flatMap(e=>{const b=e.getBoundingClientRect();return b.left<bounds.left-1||b.right>bounds.right+1?[e.id||e.getAttribute('aria-label')]:[];});
    return{overflow:document.documentElement.scrollWidth-innerWidth,outside,h1:document.querySelectorAll('h1').length,dark:document.documentElement.classList.contains('dark'),style:document.documentElement.dataset.uiStyle};
  });
  report.layouts.push({route,width,mode,owner,...metrics});assert.ok(metrics.overflow<=1,route+'/'+width+' overflow '+metrics.overflow);assert.deepEqual(metrics.outside,[],route+'/'+width+' fields');assert.equal(metrics.h1,1);assert.equal(metrics.dark,mode==='dark');assert.equal(metrics.style,'neobrutalism');
}
async function dialogBounds(name) {
  const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
  const b=await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight};});
  assert.ok(b.left>=0&&b.right<=b.w+1&&b.top>=0&&b.bottom<=b.h+1,name+' bounds');report.dialogs.push({name,...b});return dialog;
}
async function owner(mode='light') {
  context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce',extraHTTPHeaders:{origin:base}});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
  await context.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode,uiStyle:'material3',themeId:'classic'})),mode);
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
}
try {
  for(const mode of ['light','dark']) {
    await owner(mode);
    for(const width of [1440,1320,1280,941,768,390,360]) {
      await page.setViewportSize({width,height:1000});
      for(const route of routes) {
        await goto(route);await geometry(route,width,mode,true);
        if(mode==='light'&&[941,390].includes(width)||mode==='dark'&&width===1280)await shot(route.slice(1).replaceAll('/','-')+'-'+width+'-'+mode);
      }
      console.log('Discovery '+width+' '+mode+': 4 routes passed');
    }
    await context.close();
  }
  report.cases.push('56 owner route/viewport/mode layouts with legacy style recovery');
  await owner();await page.setViewportSize({width:1280,height:1000});await goto('/nav');
  await page.getByLabel('查找收藏的网站',{exact:true}).fill('GitHub');assert.equal(await page.locator('[data-cat-panel="all"] [data-nav-search]:not([hidden])').count(),1);
  await page.locator('[data-cat-tab="review-dev"]').filter({visible:true}).click();assert.ok((await page.locator('#nav-search-status').textContent()).includes('匹配 1'));
  await page.getByRole('button',{name:'清除网站搜索',exact:true}).click();assert.equal(await page.locator('#nav-search').inputValue(),'');
  await page.locator('#nav-search').fill('NO_MATCH_REVIEW');await page.locator('#nav-search-empty').waitFor({state:'visible'});await shot('nav-search-empty-1280');await page.getByRole('button',{name:'清除网站搜索',exact:true}).click();
  for(const width of [1280,390,360]) {
    await page.setViewportSize({width,height:1000});
    await page.locator('[data-site-add="review-dev"]').first().click();await dialogBounds('添加网址');await shot('nav-add-dialog-'+width);await page.keyboard.press('Escape');
    await page.locator('[data-site-edit="review-site-0"]').click();await dialogBounds('编辑网址');await page.keyboard.press('Escape');
    await page.locator('[data-cat-add]').filter({visible:true}).first().click();await dialogBounds('添加分类');await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-site-edit="review-site-0"]').click();await page.locator('#nav-edit-name').fill('GitHub · 已编辑');await page.locator('#nav-edit-confirm').click();await page.locator('#nav-edit-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#nav-title').textContent(),'验收示例 · 开发工具');
  await page.reload();await page.waitForTimeout(300);assert.equal(await page.locator('#nav-title').textContent(),'验收示例 · 开发工具');await page.getByText('GitHub · 已编辑',{exact:true}).filter({visible:true}).waitFor();
  await page.locator('[data-sub-input="review-dev"]').fill('验收示例 · 新子分类');await page.locator('[data-sub-add="review-dev"]').click();await page.getByText('验收示例 · 新子分类',{exact:true}).first().waitFor();
  await page.locator('[data-site-id="review-site-0"]').dragTo(page.locator('[data-drop-cat="review-learn"]'));
  await page.waitForFunction(()=>{const data=JSON.parse(document.getElementById('nav-data').dataset.categories);return data.find(c=>c.id==='review-learn').sites.some(s=>s.id==='review-site-0');});
  report.cases.push('local website search/clear/no matches; category and subcategory persistence; real site drag between categories');
  await goto('/admin/nav');await page.getByLabel('分类名',{exact:true}).fill('验收示例 · 新分类');await page.locator('#cat-save').click();await page.locator('#cat-list').getByText('验收示例 · 新分类',{exact:true}).waitFor();
  await page.getByLabel('网站名',{exact:true}).fill('验收示例 · 新网站');await page.getByLabel('网站网址',{exact:true}).fill('https://example.invalid/new');await page.getByLabel('网站简介',{exact:true}).fill('隔离验收记录');await page.getByLabel('网站图标 URL',{exact:true}).fill(base+'/images/neobrutalism/cat-peek.webp');await page.locator('#site-cat').selectOption('review-dev');await page.locator('#site-save').click();await page.locator('#site-groups').getByText('验收示例 · 新网站',{exact:true}).waitFor();
  report.cases.push('navigation manager category/site creation via existing APIs and in-place rendering');
  await goto('/gallery');assert.equal(await page.locator('.photo-card').count(),30);assert.equal(await page.locator('#gallery-groups').getAttribute('data-total'),'65');
  const first=page.locator('[data-lightbox]').first();await first.focus();await page.keyboard.press('Enter');await dialogBounds('图片预览');assert.equal(await page.locator('.lightbox-view img').getAttribute('src'),'/images/neobrutalism/article-fallback.webp');await page.keyboard.press('ArrowRight');await page.locator('.lightbox-count').getByText('2 / 30',{exact:true}).waitFor();await shot('gallery-lightbox-1280');await page.keyboard.press('Escape');assert.equal(await first.evaluate(e=>e===document.activeElement),true);
  await page.locator('[data-timeline-date="2026-09-26"]').click();await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===65);assert.equal(await page.locator('.photo-card').evaluateAll(cards=>new Set(cards.map(c=>c.dataset.photoId)).size),65);await page.locator('#gallery-more-wrap').waitFor({state:'hidden'});
  const last=await page.request.get(base+'/api/photos?offset=60&limit=30');const lastData=await last.json();assert.equal(lastData.total,65);assert.equal(lastData.photos.length,5);assert.equal(lastData.timeline.reduce((n,d)=>n+d.count,0),65);
  await goto('/gallery?tag='+encodeURIComponent('风景'));assert.equal(await page.locator('#gallery-groups').getAttribute('data-total'),'33');
  report.cases.push('65-photo paging without duplicates; oldest-date loading; real totals and full timeline; tag filter; keyboard lightbox/focus restore');
  await goto('/gallery?tag='+encodeURIComponent('不存在的验收标签'));await page.getByText('影集还是空的',{exact:true}).waitFor();await shot('gallery-empty-1280');
  await page.route('**/images/neobrutalism/article-fallback.webp',route=>route.fulfill({status:404,body:''}));await goto('/gallery');await page.locator('#gallery-broken-empty').waitFor({state:'visible'});assert.equal(await page.locator('.photo-card').count(),0);await shot('gallery-image-failure-1280');await page.unroute('**/images/neobrutalism/article-fallback.webp');
  report.cases.push('unknown tag empty state and cached image failures remove broken cards with visible retry guidance');
  await goto('/gallery/upload');assert.equal(await page.locator('#drop-zone').count(),0);
  await page.locator('#url-input').fill(base+'/images/neobrutalism/cat-peek.webp');await page.locator('#url-title').fill('验收示例 · URL 导入');await page.locator('#url-tags').fill('验收示例,新增');await page.locator('#url-import-btn').click();
  const imported=page.locator('.manage-card').filter({has:page.locator('input[value="验收示例 · URL 导入"]')});await imported.waitFor();
  await imported.getByLabel('照片标题',{exact:true}).fill('验收示例 · 已保存');await imported.getByRole('button',{name:'保存',exact:true}).click();await page.waitForTimeout(350);await page.reload();
  const saved=page.locator('.manage-card').filter({has:page.locator('input[value="验收示例 · 已保存"]')});await saved.waitFor();await saved.getByLabel('选择这张照片',{exact:true}).check();await page.locator('#batch-tags').fill('批量验收');await page.locator('#batch-op').selectOption('add');await page.locator('#batch-apply').click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-manage-title]')].find(e=>e.value==='验收示例 · 已保存').closest('.manage-card').querySelector('[data-manage-tags]').value.includes('批量验收'));
  await saved.getByRole('button',{name:'删除',exact:true}).click();await dialogBounds('操作确认');await page.getByRole('button',{name:'删除',exact:true}).last().click();await saved.waitFor({state:'detached'});
  report.cases.push('real URL import, photo metadata save/reload, batch tag addition and isolated deletion');
  // Enable only fake credentials to exercise the queue; intercept every upload before the server.
  const copy=new Database(meta.databasePath);copy.prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)').run('image_bed',JSON.stringify({enabled:true,owner:'acceptance-fixture',repo:'acceptance-fixture',branch:'main',token:'acceptance-not-a-real-token'}),Date.now());copy.close();
  try {
    await page.route('**/api/photos',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"验收上传失败"}'}):route.continue());
    await goto('/gallery/upload');await page.locator('#file-input').setInputFiles(['public/images/neobrutalism/cat-peek.webp','public/images/neobrutalism/cat-rest.webp']);assert.equal(await page.locator('#upload-list img').count(),2);
    await page.locator('#upload-btn').click();await page.locator('#upload-list').getByText('验收上传失败',{exact:true}).first().waitFor();await page.waitForTimeout(200);
    for(const width of [941,390,360]){await page.setViewportSize({width,height:1000});await geometry('/gallery/upload#queue',width,'light',true);await shot('gallery-upload-queue-'+width);}
    report.cases.push('two-file upload queue, canvas preparation and retained error rows with mocked storage; no remote writes');
  } finally { const copy=new Database(meta.databasePath);copy.prepare("DELETE FROM settings WHERE key='image_bed'").run();copy.close();await page.unroute('**/api/photos'); }
  await context.close();
  for(const mode of ['light','dark']) {
    context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',extraHTTPHeaders:{origin:base}});await context.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode})),mode);page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    for(const width of [1440,1320,1280,941,768,390,360]){await page.setViewportSize({width,height:1000});for(const route of ['/nav','/gallery']){await goto(route);await geometry(route,width,mode,false);assert.equal(await page.locator('[data-site-edit],[data-cat-add],a[href="/admin/nav"],a[href="/gallery/upload"]').count(),0);}}
    for(const route of ['/admin/nav','/gallery/upload','/gallery/manage-cards?id=review-photo-0'])assert.equal((await page.request.get(base+route,{maxRedirects:0})).status(),302);
    for(const route of ['/api/nav/sites','/api/photos'])assert.ok([401,403].includes((await page.request.post(base+route,{data:{}})).status()));await context.close();
  }
  report.cases.push('28 guest public layouts; manager links absent and page/partial/write API permissions enforced');assert.deepEqual(report.errors,[]);
} catch(error) { if(page&&!page.isClosed())await shot('failure');throw error; }
finally { fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close(); }
console.log('Discovery browser verification passed: '+report.layouts.length+' layouts, '+report.dialogs.length+' dialogs');
