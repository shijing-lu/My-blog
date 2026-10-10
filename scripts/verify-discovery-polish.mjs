import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out=path.resolve('outputs/discovery-workspace'),base='http://127.0.0.1:43227';
const report={layouts:[],errors:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(response.ok);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  for(const mode of ['light','dark']) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);await context.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode})),mode);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    for(const width of mode==='light'?[1440,941,390,360]:[1280]) {
      await page.setViewportSize({width,height:1000});
      for(const route of ['/nav','/admin/nav','/gallery','/gallery/upload']) {
        await page.goto(base+route);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);
        const metrics=await page.evaluate(()=>{
          const root=document.querySelector('.neo-discovery'),b=root.getBoundingClientRect();
          return{overflow:document.documentElement.scrollWidth-innerWidth,h1:document.querySelectorAll('h1').length,
            fields:[...root.querySelectorAll('input:not([type="file"]),select')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})).flatMap(e=>{const r=e.getBoundingClientRect();return r.left<b.left||r.right>b.right?[e.id]:[];}),
            categoryNameWidth:document.getElementById('cat-name')?.getBoundingClientRect().width,
            visibleCategories:[...document.querySelectorAll('[data-cat-tab]')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})).length};
        });
        assert.ok(metrics.overflow<=1,route+' '+width);assert.equal(metrics.h1,1);assert.deepEqual(metrics.fields,[]);
        if(route==='/admin/nav'&&width<768)assert.ok(metrics.categoryNameWidth>=200,'mobile category name width');
        if(route==='/nav')assert.ok(metrics.visibleCategories>=5,'responsive category navigation');
        report.layouts.push({route,width,mode,...metrics});
        if(mode==='dark'||[941,390].includes(width))await page.screenshot({path:path.join(out,route.slice(1).replaceAll('/','-')+'-'+width+'-'+mode+'.png')});
        if(mode==='light'&&width===941&&route==='/gallery/upload') {
          await page.locator('.manage-card').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'gallery-manage-cards-941.png')});
        }
        if(mode==='light'&&width===360&&route==='/gallery/upload') {
          await page.locator('.neo-gallery-storage-help summary').click();await page.waitForTimeout(100);
          const help=await page.locator('.neo-gallery-storage-help').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(help.scroll<=help.width+1,'wrapped storage help');
          await page.screenshot({path:path.join(out,'gallery-storage-help-360.png')});
        }
      }
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
} finally {fs.writeFileSync(path.join(out,'polish-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log('Discovery polish passed: '+report.layouts.length+' layouts, compact fields and wrapped help');
