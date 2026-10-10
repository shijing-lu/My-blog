import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const base='http://127.0.0.1:43223',out=path.resolve('outputs/article-workspace');
const meta=JSON.parse(fs.readFileSync(path.join(out,'server.json'),'utf8'));
assert.equal(meta.databasePath,path.join(out,'test.db'));assert.equal(meta.port,43223);
const f=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8'));
const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(login.ok);
const cookie=login.headers.get('set-cookie').split(';')[0];
const report={layouts:[],cases:[],errors:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
const routes=[['library','/doc'],['doc',`/doc/${f.bundle}?article=${f.first}`],['desk','/edit'],['edit',`/edit/${f.articles.tech.id}`],['admin','/admin'],['tech',`/blog/${f.articles.tech.slug}`],['note',`/blog/${f.articles.note.slug}`],['photo',`/blog/${f.articles.photo.slug}`],['locked',`/blog/${f.locked.slug}`]];
const context=await browser.newContext({extraHTTPHeaders:{origin:base},viewport:{width:1440,height:1000}});
await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
try{
 for(const mode of ['light','dark'])for(const width of [1440,1320,1280,941,768,390,360]){
  await page.setViewportSize({width,height:900});
  await page.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode,uiStyle:'classic',themeId:'material3'})),mode);
  for(const [name,route]of routes){
   const response=await page.goto(base+route,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,route);
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(80);
   const metrics=await page.evaluate(()=>{
    const rect=id=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height}};
    const paper=document.querySelector('.article-paper')?.getBoundingClientRect();
    return{overflow:document.documentElement.scrollWidth-innerWidth,h1:document.querySelectorAll('.article-paper > header h1,.article-paper > div > header h1,.neo-library [data-hero] h1,.neo-article-manager > header h1').length,dark:document.documentElement.classList.contains('dark'),left:rect('doc-ltoc-aside'),right:rect('doc-toc-panel'),paper:paper?{x:paper.x,right:paper.right}:null,collapsed:document.getElementById('doc-toc-aside')?.dataset.collapsed,outline:document.querySelector('.article-paper')?getComputedStyle(document.querySelector('.article-paper')).borderTopWidth:null};
   });
   report.layouts.push({name,width,mode,...metrics});assert.ok(metrics.overflow<=1,`${name}/${width}/${mode} overflow ${metrics.overflow}`);assert.equal(metrics.h1,1);assert.equal(metrics.dark,mode==='dark');
   if(['doc','edit','desk'].includes(name)&&width>=1320){assert.equal(metrics.left.width,220);assert.equal(metrics.right.width,240);assert.ok(metrics.paper.right<=metrics.right.x-14,'right rail must reserve a column');}
   if(width<1320&&metrics.collapsed)assert.equal(metrics.collapsed,'true');
   if((width===1440||width===390)&&mode==='light'||width===1280&&mode==='dark')await page.screenshot({path:path.join(out,`${name}-${width}-${mode}.png`)});
  }
  console.log('Layout group '+width+' '+mode+' passed');
 }
 report.cases.push('126 route/viewport/mode layouts, no page overflow, one shell title, desktop columns and default overlay state');
 await page.setViewportSize({width:1440,height:900});await page.goto(base+`/doc/${f.bundle}?article=${f.first}`);await page.evaluate(()=>document.fonts.ready);
 assert.ok(await page.locator('[data-article-switch]').count()>=296);assert.equal(await page.locator('details[data-folder]').count(),6);assert.equal(await page.locator('#doc-toc-list a').count(),200);
 const row=page.locator('[data-article-switch]').filter({hasText:'第 010 篇'}).first();assert.ok(await row.evaluate(e=>e.parentElement.getBoundingClientRect().height)<=34);
 const long=page.locator('[data-directory-title]').filter({hasText:'这是一个很长的标题'}).first();await long.focus();await page.locator('#article-directory-tooltip').waitFor();assert.ok((await page.locator('#article-directory-tooltip').textContent()).includes('完整标题提示'));
 await page.locator('details[data-folder] > summary').first().click();assert.equal(await page.locator('details[data-folder]').first().getAttribute('open'),null);await page.locator('details[data-folder] > summary').first().click();
 await page.evaluate(()=>scrollTo(0,0));await page.locator('#doc-ltoc-body').hover();const before=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,500);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>scrollY),before);assert.ok(await page.locator('#doc-ltoc-body').evaluate(e=>e.scrollTop)>0);
 await page.locator('#doc-toc-rail').hover();await page.mouse.wheel(0,500);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>scrollY),before);assert.ok(await page.locator('#doc-toc-rail').evaluate(e=>e.scrollTop)>0);
 await page.locator('#doc-toc-rail').evaluate(e=>e.scrollTop=e.scrollHeight);await page.mouse.wheel(0,500);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>scrollY),before);
 report.cases.push('302 left nodes, six folder levels, 200 right chapters: compact rows, full keyboard titles, fold and independent boundary scrolling');
 await page.setViewportSize({width:390,height:844});await page.goto(base+`/doc/${f.bundle}?article=${f.first}`);
 assert.ok(await page.locator('[data-article-switch]').first().evaluate(e=>e.parentElement.getBoundingClientRect().height)>=44);
 await page.locator('#doc-ltoc-toggle').click();assert.equal(await page.locator('#doc-ltoc-body').isVisible(),false);await page.locator('#doc-ltoc-toggle').click();assert.equal(await page.locator('#doc-ltoc-body').isVisible(),true);
 await page.locator('#doc-toc-fab').click();assert.equal(await page.locator('#doc-toc-overlay').isVisible(),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('#doc-toc-panel')!==null),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#doc-toc-panel').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'doc-toc-fab');
 await page.locator('#doc-toc-fab').click();await page.locator('#doc-toc-overlay').click({position:{x:5,y:400}});assert.equal(await page.locator('#doc-toc-panel').isVisible(),false);
 report.cases.push('mobile left toggle, 44px rows, right overlay, keyboard loop, Esc/mask close and focus return');
 const db=new Database(meta.databasePath,{readonly:true});let count;try{count=db.prepare('SELECT count(*) n FROM articles').get().n;}finally{db.close();}
 const redirect=await context.request.get(base+'/edit/new?parent=example',{maxRedirects:0});assert.equal(redirect.status(),302);assert.ok(redirect.headers().location.includes('/edit?parent=example'));
 const dbAfter=new Database(meta.databasePath,{readonly:true});try{assert.equal(dbAfter.prepare('SELECT count(*) n FROM articles').get().n,count);}finally{dbAfter.close();}
 report.cases.push('/edit/new redirects with parent and does not create an article');
 const guest=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const gp=await guest.newPage();
 await gp.goto(base+`/doc/${f.bundle}?article=${f.first}`);assert.equal(await gp.locator('#doc-inline-edit,#doc-add-root-folder,[data-tree-menu-trigger]').count(),0);
 await gp.goto(base+'/doc');assert.equal(await gp.locator('#doc-manage-toggle').count(),0);
 await gp.goto(base+`/blog/${f.locked.slug}`);assert.equal(await gp.locator('#article-gate').count(),1);assert.ok(!(await gp.content()).includes('PRIVATE_REVIEW_SENTINEL'));assert.equal(await gp.locator('[data-export-md]').count(),0);assert.equal(await gp.locator('#doc-ltoc-aside').count(),0);
 await gp.screenshot({path:path.join(out,'guest-locked-390.png')});
 report.cases.push('guest no document management, protected content absent server-side, no export before unlock, public page has no private left tree');
 await guest.close();
 assert.deepEqual(report.errors,[]);
}finally{fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log('ARTICLE_WORKSPACE_OK layouts='+report.layouts.length+' cases='+report.cases.length);
