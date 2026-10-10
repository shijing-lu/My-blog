/** Browser acceptance against an isolated local build. Never point at production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.NEO_VERIFY_BASE || 'http://127.0.0.1:43221';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('outputs/neobrutalism');
fs.mkdirSync(output,{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const report = { samples:[], checks:[], errors:[], failures:[] };
const check = (condition,label) => { report.checks.push({label,passed:Boolean(condition)}); if(!condition) report.failures.push(label); };
async function context(mode='light',width=941,legacy='classic') {
  const ctx = await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce',colorScheme:mode==='light'?'light':'dark'});
  await ctx.addInitScript(({mode,legacy})=>{if(!localStorage.getItem('my-blog-theme'))localStorage.setItem('my-blog-theme',JSON.stringify({mode,themeId:'terminal',uiStyle:legacy}));},{mode,legacy});
  return ctx;
}
async function load(page,url='/') {
  await page.goto(base+url,{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);
}
async function sample(page,label) {
  const value=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,style:document.documentElement.dataset.uiStyle,mode:document.documentElement.dataset.mode,dark:document.documentElement.classList.contains('dark'),theme:document.documentElement.dataset.theme,rows:document.querySelectorAll('#post-grid .post-row').length,h1:document.querySelectorAll('h1').length,toolbars:document.querySelectorAll('.side-toolbar').length,font:getComputedStyle(document.body).fontFamily,hero:document.querySelector('.neo-hero')?.getBoundingClientRect().height,stats:document.querySelector('.neo-stats')?.getBoundingClientRect().height,latest:document.querySelector('.neo-latest')?.getBoundingClientRect().height}));
  report.samples.push({label,...value});
  check(value.scrollWidth<=value.width,label+' no page overflow');
  check(value.style==='neobrutalism' && !value.theme,label+' obsolete appearance ignored');
  check(value.h1===1 && value.rows===5 && value.toolbars===1,label+' single heading, five articles, one toolbar');
  if(value.width>600)check(await page.locator('.side-toolbar').evaluate(e=>Math.abs(e.getBoundingClientRect().top-170)<1),label+' toolbar matches reference vertical position');
  const contrast=await page.evaluate(()=>{
    const luminance=(color)=>{const values=color.match(/[\d.]+/g)?.slice(0,3).map(Number)||[0,0,0];return values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);};
    return ['.neo-search-categories .active','.pagination-btn-active','.neo-post-summary','.neo-page-summary'].map(selector=>{const e=document.querySelector(selector);if(!e)return 21;let bg=e;while(bg.parentElement && getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;const a=luminance(getComputedStyle(e).color),b=luminance(getComputedStyle(bg).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
  });
  check(contrast.every(ratio=>ratio>=4.5),label+' small text contrast');
  await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});
}
try {
  for(const mode of ['light','dark']) for(const width of [1440,1280,941,768,390,360]) {
    const ctx=await context(mode,width);const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await load(p);await sample(p,`home-${mode}-${width}`);check(await p.locator('#tag-filter-bar').isHidden(),'tag status initially hidden');
    if(width<600) { check(await p.locator('[data-m3-tools-body]').isHidden(),'phone tools initially folded');await p.locator('[data-m3-tools-toggle]').click();check(await p.locator('[data-m3-tools-body]').isVisible(),'phone tools expand');check(await p.locator('[data-m3-tools-toggle] svg').count()===1,'phone tool icon exists');await p.keyboard.press('Escape');check(await p.locator('[data-m3-tools-body]').isHidden(),'Escape collapses phone tools');await p.locator('[data-site-menu]').click();check(await p.locator('#site-navigation').isVisible(),'phone menu opens');await p.keyboard.press('Escape');check(await p.locator('#site-navigation').isHidden(),'Escape closes phone menu'); }
    await ctx.close();
  }
  const ctx=await context('light');const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await load(p);
  check(await p.locator('.post-row-edit').count()===0 && await p.locator('#rt-quick-notes').count()===0 && await p.locator('[data-open-settings]').count()===0,'guest has no restricted controls');
  await p.locator('[data-home-search]').click();check(await p.locator('#search-input').evaluate(e=>e===document.activeElement),'header search focuses input');
  await p.locator('#search-input').fill('Codex');await p.waitForFunction(()=>/^命中/.test(document.querySelector('#search-count')?.textContent||''));check(await p.locator('#search-results .post-row').count()>0,'real API search renders articles');check(await p.locator('#search-results .neo-post-cover').count()>0,'search renders thumbnails');await p.screenshot({path:path.join(output,'search-results.png'),fullPage:true});
  await p.locator('#search-input').fill('');await p.waitForFunction(()=>!document.querySelector('#post-grid')?.classList.contains('hidden'));check(await p.locator('#post-pagination').isVisible(),'clearing search restores pagination');
  const tag=p.locator('#post-grid [data-tag-filter]').first();if(await tag.count()) { await tag.click();check(await p.locator('#tag-filter-bar').isVisible(),'tag filter states current-page scope');await p.waitForTimeout(300);check(await p.locator('#post-pagination').isHidden(),'tag filter stays active after search debounce');await p.locator('#tag-filter-clear').click();check(await p.locator('#tag-filter-bar').isHidden(),'clear tag filter hides status'); }
  await p.locator('[data-cat-filter]').nth(1).click();await p.waitForFunction(()=>/^命中/.test(document.querySelector('#search-count')?.textContent||''));check(await p.locator('#post-grid').isHidden(),'category uses full-site search');await p.locator('[data-cat-filter="all"]').click();check(await p.locator('#post-grid').isVisible(),'all categories restores static list');
  await p.locator('#wechat-btn').click();check(await p.locator('#wechat-dialog').evaluate(e=>e.open),'WeChat opens');await p.keyboard.press('Escape');check(await p.locator('#wechat-btn').evaluate(e=>e===document.activeElement),'dialog focus returns to opener');
  await p.locator('#theme-settings-btn').click();await p.locator('[data-mode-btn="dark"]').click();check(await p.evaluate(()=>document.documentElement.classList.contains('dark')),'mode button changes to dark');await p.keyboard.press('Escape');await p.locator('#site-navigation a[href="/nav"]').click();await p.waitForURL('**/nav');check(await p.evaluate(()=>document.documentElement.dataset.uiStyle==='neobrutalism'&&document.documentElement.classList.contains('dark')),'mode survives cross-page navigation');await p.locator('[data-home-search]').click();await p.waitForURL('**/#search-input');await p.waitForFunction(()=>document.activeElement?.id==='search-input');check(true,'cross-page search focuses input');
  await load(p,'/?page=2');check(await p.locator('#post-grid .post-row').count()===5,'page two has five articles');await p.locator('#pagination-page-input').fill('3');await p.locator('.pagination-jump button').click();await p.waitForURL('**/?page=3');check(await p.locator('.pagination-btn-active').innerText()==='3','jump page works');
  for(const page of ['NaN','-1','9999']) { await load(p,'/?page='+page);check(await p.locator('#post-grid .post-row').count()>0,'invalid page '+page+' is normalized'); }
  // Broken image boundary, then long configured content and encrypted metadata via a mocked response.
  await load(p);await p.locator('.neo-post-cover').first().evaluate(e=>e.src='/missing-neo-cover.webp');await p.waitForFunction(()=>document.querySelector('.neo-post-cover')?.getAttribute('src')==='/images/neobrutalism/article-fallback.webp');check(true,'failed cover uses fallback');
  await p.route('**/api/search?**',route=>route.fulfill({json:{total:75,articles:[{id:'fixture',slug:'fixture',title:'长标题边界验证'.repeat(15),summary:'摘要内容'.repeat(20),snippet:'摘要内容'.repeat(20),cover:null,tags:['测试'],updatedAt:new Date().toISOString(),charCount:12000,encrypted:true}]}}));
  await p.locator('#search-input').fill('boundary');await p.waitForFunction(()=>/75/.test(document.querySelector('#search-count')?.textContent||''));check((await p.locator('#search-count').innerText()).includes('50'),'real total and search cap are explicit');check(await p.locator('#search-results .neo-encrypted').count()===1,'encrypted search metadata is marked');await p.setViewportSize({width:360,height:950});check(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'long title stays within phone viewport');
  await ctx.close();
  const system=await context('system',941,'material3');const sp=await system.newPage();await load(sp);check(await sp.evaluate(()=>document.documentElement.classList.contains('dark')),'system follows initial dark preference');await sp.emulateMedia({colorScheme:'light'});await sp.waitForFunction(()=>!document.documentElement.classList.contains('dark'));check(true,'system responds to preference change');await system.close();
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:process.env.NEO_VERIFY_PASSWORD||'neobrutalism-local-check'})});check(login.ok,'isolated administrator login');const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const admin=await context('light',1280);await admin.addCookies([{name:cookie.slice(0,cookie.indexOf('=')),value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true}]);const ap=await admin.newPage();ap.on('pageerror',e=>report.errors.push(e.message));await load(ap);check(await ap.locator('.post-row-edit').count()===5,'administrator retains article edit entries');check(await ap.locator('#rt-quick-notes').count()===1,'owner retains quick notes');await ap.locator('[data-open-settings]').first().click();await ap.locator('#settings-modal').waitFor({state:'visible'});check(true,'site settings opens');await ap.keyboard.press('Escape');
  await ap.locator('#rt-quick-notes').click();await ap.getByRole('dialog',{name:'随心录编辑器'}).waitFor({state:'visible'});check(true,'quick notes opens');await ap.keyboard.press('Escape');
  if(await ap.locator('#rt-ai').count()) { await ap.locator('#rt-ai').click();await ap.locator('#ai-chat-float').waitFor({state:'visible'});check(true,'AI panel opens without sending a message');await ap.keyboard.press('Escape'); }
  for(const route of ['/admin','/admin/settings/appearance','/schedule']) { await load(ap,route);if(route==='/schedule') await ap.locator('.cadence-shell').waitFor();check(await ap.evaluate(()=>document.documentElement.dataset.uiStyle==='neobrutalism'),'new shell '+route);await ap.screenshot({path:path.join(output,route.replaceAll('/','-').slice(1)+'.png'),fullPage:true}); }
  await admin.close();
} catch(error) { report.failures.push(error.stack); }
finally { await browser.close();fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)); }
console.log(JSON.stringify({samples:report.samples.length,checks:report.checks.length,errors:report.errors,failures:report.failures},null,2));
assert.equal(report.failures.length,0,'browser acceptance failed; see verification.json');assert.equal(report.errors.length,0,'browser runtime errors');
