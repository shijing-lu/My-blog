import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const out = path.resolve('outputs/schedule-workspace');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'server.json'), 'utf8'));
assert.equal(meta.databasePath, path.join(out, 'test.db'));
assert.equal(meta.port, 43226);
const base = 'http://127.0.0.1:43226';
const routes = ['/schedule', '/schedule/plans', '/schedule/schedule', '/schedule/execute', '/schedule/review', '/schedule/todos', '/schedule/stats', '/schedule/settings', '/calendar'];
const interactionsOnly = process.env.SCHEDULE_INTERACTIONS_ONLY === '1';
const previous = interactionsOnly ? JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json'), 'utf8')) : null;
const report = { layouts: previous?.layouts.filter(item=>item.owner) ?? [], dialogs: [], cases: [], errors: [], fixtures: 'Isolated browser IndexedDB and copied SQLite; all examples labelled acceptance fixtures.' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-review-local' }) });
assert.ok(login.ok);
const cookie = login.headers.get('set-cookie').split(';')[0];
let context, page;
const goto = async url => {
  const response = await page.goto(base + url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200, url);
  if (url.startsWith('/schedule')) await page.locator('.cadence-shell h1').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(230);
};
const shot = async name => { await page.evaluate(()=>document.querySelectorAll('[data-m3-role="snackbar"] button[aria-label="关闭提示"]').forEach(button=>button.click())); await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, name + '.png') }); };
const read = (store, key) => page.evaluate(({store,key}) => new Promise((resolve,reject) => {const req=indexedDB.open('byqx-cadence');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction(store);const query=key ? tx.objectStore(store).get(key):tx.objectStore(store).getAll();query.onsuccess=()=>resolve(query.result);tx.oncomplete=()=>db.close();};}),{store,key});
async function seed() {
  await page.evaluate(async () => {
    const now = Date.now(), day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('byqx-cadence');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const rows = {plans:[],tasks:[],sessions:[],todos:[],reviewSchedules:[],countdowns:[],dailyPlans:[],scheduleEvents:[]};
    for(let i=0;i<6;i++) rows.plans.push({id:'acceptance-plan-'+i,title:'验收示例 · '+['博客界面改造与多层长标题检查','阅读与笔记整理','运动计划','学习 TypeScript','整理摄影记录','周末复盘'][i],description:'仅用于隔离验收，不属于实际计划。',status:i===5?'completed':'active',color:'plan',tags:['验收示例'],createdAt:now,updatedAt:now,deletedAt:0});
    rows.tasks.push({id:'acceptance-task',planId:'acceptance-plan-0',title:'验收示例 · 检查手机界面',status:'doing',order:1,estimateMinutes:30,tags:[],createdAt:now,updatedAt:now,deletedAt:0});
    const axisTx = db.transaction('axisConfigs');const axis=await new Promise(resolve=>{const r=axisTx.objectStore('axisConfigs').getAll();r.onsuccess=()=>resolve(r.result[0]);});
    for(let i=0;i<5;i++) rows.todos.push({id:'acceptance-todo-'+i,title:'验收示例 · '+['整理今天的记录','读一章书','完成长标题的手机布局与状态验证','休息十分钟','完成的待办'][i],note:'仅用于界面验收。',status:i===4?'done':'open',axisConfigId:axis.id,coordinate:{x:20+i*15,y:20+i*14},tags:['验收示例'],createdAt:now,updatedAt:now,deletedAt:0});
    rows.reviewSchedules.push({id:'acceptance-review',title:'验收示例 · 每八小时复盘',intervalHours:8,anchorOffsetMs:0,enabled:true,order:0,prompt:'今天做了什么？下一步是什么？',createdAt:now,updatedAt:now,deletedAt:0});
    rows.countdowns.push({id:'acceptance-countdown',name:'验收示例 · 阅读时间',unit:'hour',targetAt:now+7200000,color:'plan',order:0,createdAt:now,updatedAt:now,deletedAt:0});
    rows.dailyPlans.push({id:'daily-'+day,dateKey:day,items:[{id:'acceptance-item',kind:'free',title:'验收示例 · 整理学习笔记',done:false,order:0}],createdAt:now,updatedAt:now});
    rows.scheduleEvents.push({id:'acceptance-event',dateKey:day,title:'验收示例 · 阅读与整理',startMin:540,endMin:585,refKind:'free',done:false,createdAt:now,updatedAt:now});
    for(let i=0;i<7;i++) rows.sessions.push({id:'acceptance-session-'+i,planId:'acceptance-plan-0',startedAt:now-(i+1)*86400000,endedAt:now-(i+1)*86400000+1800000,pausedMs:0,note:'验收示例 · 学习记录',createdAt:now,updatedAt:now});
    await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite');for(const [store,items] of Object.entries(rows)) for(const item of items)tx.objectStore(store).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    db.close();
  });
}
async function geometry(route, width, mode, owner) {
  const metrics = await page.evaluate(() => {
    const root=document.querySelector('.cadence-shell') ?? document.querySelector('.neo-calendar-workspace');
    const bounds=root.getBoundingClientRect();
    const outside=[...root.querySelectorAll('input:not([type="hidden"]),select,textarea,[data-m3-role="button"]')].filter(el=>el.checkVisibility({checkVisibilityCSS:true})).flatMap(el=>{const b=el.getBoundingClientRect();return b.left<bounds.left-1||b.right>bounds.right+1?[{tag:el.tagName,label:el.getAttribute('aria-label')||el.textContent.slice(0,35),left:b.left,right:b.right}]:[];});
    return {overflow:document.documentElement.scrollWidth-innerWidth,outside,h1:document.querySelectorAll('h1').length,dark:document.documentElement.classList.contains('dark'),style:document.documentElement.dataset.uiStyle};
  });
  report.layouts.push({route,width,mode,owner,...metrics});
  assert.ok(metrics.overflow<=1, route+'/'+width+' overflow '+metrics.overflow);
  assert.deepEqual(metrics.outside,[],route+'/'+width+' field bounds');
  assert.equal(metrics.h1,1);assert.equal(metrics.dark,mode==='dark');assert.equal(metrics.style,'neobrutalism');
}
async function dialogBounds(name) {
  const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
  for(let attempt=0;attempt<30;attempt++){if(await dialog.evaluate(e=>Number(getComputedStyle(e).opacity)>=.999))break;await page.waitForTimeout(30);}
  assert.ok(await dialog.evaluate(e=>Number(getComputedStyle(e).opacity)>=.999),name+' settled opacity');
  const data=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();const outside=[...el.querySelectorAll('input,textarea,select,button')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})).flatMap(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1?[e.getAttribute('aria-label')||e.textContent]:[];});return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,innerWidth,innerHeight,outside};});
  report.dialogs.push({name,...data});assert.ok(data.left>=0&&data.right<=data.innerWidth+1&&data.top>=0&&data.bottom<=data.innerHeight+1,name+' bounds');assert.deepEqual(data.outside,[],name+' field bounds');return dialog;
}
try {
  for(const mode of (interactionsOnly ? [] : ['light','dark'])) {
    context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce',extraHTTPHeaders:{origin:base}});
    await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
    await context.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode,uiStyle:'material3',themeId:'classic'})),mode);
    page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await goto('/schedule');await seed();
    for(const width of [1440,1320,1280,941,768,390,360]) {
      await page.setViewportSize({width,height:1000});
      for(const route of routes) {
        await goto(route);await geometry(route,width,mode,true);
        if(mode==='light'&&[941,390].includes(width)||mode==='dark'&&width===1280&&['/schedule/schedule','/calendar'].includes(route))await shot((route.slice(1).replaceAll('/','-')||'schedule')+'-'+width+'-'+mode);
      }
      // Check menu geometry and focus return at narrow widths.
      if(width<1024){await goto('/schedule');const menu=page.getByRole('button',{name:'日程菜单',exact:true});await menu.click();await dialogBounds('日程菜单');await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'日程菜单',exact:true}).waitFor({state:'hidden'});assert.equal(await menu.evaluate(e=>e===document.activeElement),true);}
      console.log('Schedule '+width+' '+mode+': 9 routes passed');
    }
    await context.close();
  }
  report.cases.push('126 owner route/viewport/mode layouts; mobile menu Esc and focus restoration');
  // Interaction persistence uses a fresh browser context and its own IndexedDB.
  context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce',extraHTTPHeaders:{origin:base}});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:base}]);
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  for(const route of ['/schedule','/schedule/plans','/schedule/stats']){await goto(route);await shot('empty-'+route.slice(1).replaceAll('/','-')+'-1280');}
  await goto('/schedule/schedule');
  await page.getByRole('button',{name:'新建日程',exact:true}).click();await dialogBounds('新建日程');
  await page.getByLabel('标题',{exact:true}).fill('一分钟验收');
  await page.getByLabel('开始',{exact:true}).fill('09:07');await page.getByLabel('结束',{exact:true}).fill('09:07');
  assert.equal(await page.getByRole('button',{name:'创建',exact:true}).isDisabled(),true);
  await page.getByLabel('结束',{exact:true}).fill('09:08');await page.getByRole('button',{name:'创建',exact:true}).click();
  const cell=page.getByRole('gridcell',{name:'一分钟验收 09:07–09:08',exact:true});await cell.waitFor();await cell.focus();await page.keyboard.press('Enter');
  await page.getByLabel('开始',{exact:true}).fill('09:09');await page.getByLabel('结束',{exact:true}).fill('09:10');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});await page.reload();
  await page.getByRole('gridcell',{name:'一分钟验收 09:09–09:10',exact:true}).waitFor();
  await page.getByRole('button',{name:'新建日程',exact:true}).click();await page.getByLabel('标题',{exact:true}).fill('最后一分钟验收');await page.getByLabel('开始',{exact:true}).fill('23:59');await page.getByLabel('当天结束 24:00').check();await page.getByRole('button',{name:'创建',exact:true}).click();
  await page.getByRole('gridcell',{name:'最后一分钟验收 23:59–24:00',exact:true}).waitFor();report.cases.push('minute creation, invalid equal span, keyboard editing, persistence after reload and 24:00');
  await page.getByRole('button',{name:'新建日程',exact:true}).click();await page.getByLabel('标题',{exact:true}).fill('验收示例 · 拖拽时间块');await page.getByLabel('开始',{exact:true}).fill('11:00');await page.getByLabel('结束',{exact:true}).fill('11:45');await page.getByRole('button',{name:'创建',exact:true}).click();
  const moving=page.getByRole('gridcell',{name:/验收示例 · 拖拽时间块/});await moving.waitFor();await moving.scrollIntoViewIfNeeded();
  const original=(await read('scheduleEvents')).find(e=>e.title==='验收示例 · 拖拽时间块');let bounds=await moving.boundingBox();
  await page.mouse.move(bounds.x+35,bounds.y+18);await page.mouse.down();await page.mouse.move(bounds.x+35,bounds.y+29,{steps:5});await page.mouse.up();
  let moved;for(let i=0;i<30;i++){moved=await read('scheduleEvents',original.id);if(moved.startMin!==original.startMin)break;await page.waitForTimeout(50);}
  assert.ok(moved.startMin>original.startMin);assert.equal(moved.endMin-moved.startMin,45);
  await moving.scrollIntoViewIfNeeded();bounds=await moving.boundingBox();await page.mouse.move(bounds.x+40,bounds.y+bounds.height-3);await page.mouse.down();await page.mouse.move(bounds.x+40,bounds.y+bounds.height+8,{steps:5});await page.mouse.up();
  let resized;for(let i=0;i<30;i++){resized=await read('scheduleEvents',original.id);if(resized.endMin!==moved.endMin)break;await page.waitForTimeout(50);}assert.equal(resized.startMin,moved.startMin);assert.ok(resized.endMin>moved.endMin);await shot('schedule-dragged-1280');report.cases.push('real pointer move and duration resize persisted without changing the domain rules');
  for(const width of [1280,390,360]){await page.setViewportSize({width,height:1000});for(const close of await page.getByRole('button',{name:'关闭提示',exact:true}).all())await close.click();await page.getByRole('button',{name:'新建日程',exact:true}).click();await dialogBounds('新建日程');await shot('create-event-'+width);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});}
  await page.setViewportSize({width:1280,height:1000});await goto('/schedule/plans');
  await page.getByRole('button',{name:'新建计划',exact:true}).click();await dialogBounds('新建计划');await page.getByLabel('计划名称',{exact:true}).fill('验收示例 · 从界面新建的计划');await page.getByRole('button',{name:'创建',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok((await read('plans')).some(p=>p.title==='验收示例 · 从界面新建的计划'));await page.reload();await page.getByText('验收示例 · 从界面新建的计划',{exact:true}).first().waitFor();report.cases.push('plan creation and IndexedDB reload');
  await goto('/schedule');await seed();
  await goto('/schedule/execute');await page.getByRole('button',{name:'开始专注',exact:true}).click();await page.getByRole('button',{name:'结束这段专注',exact:true}).waitFor();await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'继续',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.getByRole('button',{name:'结束这段专注',exact:true}).click();
  await dialogBounds('记录复盘');await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await read('sessions')).filter(s=>s.endedAt===undefined).length,0);report.cases.push('focus start/pause/reload/resume/stop; post-focus review dialog');
  await goto('/schedule/review');await page.getByRole('button',{name:/记一笔/}).first().click();await dialogBounds('记录复盘');await page.getByLabel('复盘内容',{exact:true}).fill('验收示例 · 今天完成了界面检查。');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.reload();await page.getByText('验收示例 · 今天完成了界面检查。',{exact:true}).first().waitFor();report.cases.push('review slot editing and reload persistence');
  await goto('/schedule/todos');await page.getByRole('radio',{name:'列表',exact:true}).click();await page.getByRole('checkbox',{name:'完成 验收示例 · 整理今天的记录',exact:true}).waitFor();await page.getByRole('radio',{name:'看板',exact:true}).click();const board=page.locator('[data-testid="todo-board"]');await board.click({position:{x:25,y:25},clickCount:2});await dialogBounds('在这里记一条');await page.getByLabel('待办内容',{exact:true}).fill('验收示例 · 新增待办');await page.getByRole('button',{name:'记下',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok((await read('todos')).some(t=>t.title==='验收示例 · 新增待办'));report.cases.push('todo board/list switch and creation');
  await goto('/schedule/settings');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON 备份',exact:true}).click();const download=await downloadPromise;const exportPath=path.join(out,'acceptance-export.json');await download.saveAs(exportPath);const exported=JSON.parse(fs.readFileSync(exportPath,'utf8'));assert.equal(exported.schemaVersion,1);await page.getByLabel('选择备份',{exact:true}).setInputFiles(exportPath);await page.getByText('导入预览',{exact:true}).waitFor();await shot('schedule-import-preview-1280');report.cases.push('JSON export and import preview; no external synchronization');
  await page.locator('.cadence-sidebar').getByRole('link',{name:'待办',exact:true}).click();await page.getByRole('radio',{name:'列表',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/schedule/todos');await page.getByRole('radio',{name:'列表',exact:true}).click();
  for(const width of [390,360]){await page.setViewportSize({width,height:1000});await geometry('/schedule/todos#list',width,'light',true);await shot('schedule-todo-list-'+width);}
  await page.setViewportSize({width:1280,height:1000});await page.goBack();await page.getByRole('heading',{name:'日程设置',exact:true}).waitFor();report.cases.push('SPA navigation and history restoration; mobile todo list bounds at 390/360px');
  // Public calendar retains public anniversaries and owner-only diary/todo controls.
  const calendarFixtureId=Date.now().toString(36), calendarTodoTitle='验收示例 · 日历待办 '+calendarFixtureId, calendarEventTitle='验收示例 · 重要日期 '+calendarFixtureId, diaryText='这是一段隔离验收日记。 '+calendarFixtureId; await goto('/calendar');const day=await page.locator('#todo-add-form').getAttribute('data-date');
  await page.getByLabel('添加日历待办').fill(calendarTodoTitle);await page.getByRole('button',{name:'添加待办',exact:true}).click();await page.locator('#todo-list').getByText(calendarTodoTitle,{exact:true}).waitFor();
  await page.getByLabel('重要日期标题').fill(calendarEventTitle);await page.locator('#event-add-form button[type="submit"]').click();await page.locator('#event-list').getByText(calendarEventTitle,{exact:true}).waitFor();
  await page.locator('#all-events-btn').click();await dialogBounds('全部重要日期');await shot('calendar-all-events-1280');await page.keyboard.press('Escape');
  await page.locator('[data-diary-open]').click();const diary=page.getByRole('dialog',{name:day+'日记',exact:true});await diary.waitFor();
  for(let attempt=0;attempt<40;attempt++){if(await page.getByLabel('日记标题').isVisible())break;const edit=diary.getByRole('button',{name:'编辑',exact:true});if(await edit.isVisible()){await edit.click();break;}await page.waitForTimeout(50);}
  await page.getByLabel('日记标题').waitFor();await page.getByLabel('日记标题').fill('验收示例 · 日记');
  const editor=diary.locator('.cm-editor > .cm-scroller > .cm-content').first();await editor.waitFor();await editor.focus();await page.keyboard.press('Control+a');await page.keyboard.insertText(diaryText);
  await page.route('**/api/diary',route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'application/json',body:'{"error":"验收保存失败"}'}):route.continue());
  await diary.getByRole('button',{name:'保存日记',exact:true}).click();await diary.getByRole('status').getByText('保存失败，请重试',{exact:true}).waitFor();assert.ok((await editor.textContent()).includes('隔离验收'));await page.unroute('**/api/diary');
  await diary.getByRole('button',{name:'保存日记',exact:true}).click();await diary.getByRole('status').getByText('已保存',{exact:true}).waitFor();await shot('calendar-diary-1280');await diary.getByRole('button',{name:'关闭',exact:true}).click();
  await page.reload();await page.locator('[data-diary-open]').click();await diary.waitFor();await diary.getByText(diaryText,{exact:true}).waitFor();await page.setViewportSize({width:390,height:1000});await dialogBounds(day+'日记');await shot('calendar-diary-390');await diary.getByRole('button',{name:'关闭',exact:true}).click();
  report.cases.push('real isolated calendar todo/anniversary saves, diary failure retains text, retry, reload and mobile dialog');
  await context.close();
  for(const mode of ['light','dark']) {
    context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addInitScript(mode=>localStorage.setItem('my-blog-theme',JSON.stringify({mode})),mode);page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    for(const width of [1440,1320,1280,941,768,390,360]){await page.setViewportSize({width,height:1000});await goto('/calendar');await geometry('/calendar',width,mode,false);assert.equal(await page.locator('[data-diary-open],#todo-add-form,#event-add-form').count(),0);}
    assert.equal((await page.request.get(base+'/schedule',{maxRedirects:0})).status(),302);assert.ok([401,403].includes((await page.request.get(base+'/api/cadence/sync')).status()));assert.ok([401,403].includes((await page.request.get(base+'/api/diary?date=2026-10-08')).status()));await context.close();
  }
  report.cases.push('14 guest calendar layouts; schedule/diary/sync server access denied and private controls absent');assert.deepEqual(report.errors,[]);
} catch(error) { if(page&&!page.isClosed())await shot('failure');throw error; }
finally {fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log('Schedule browser verification passed: '+report.layouts.length+' layouts, '+report.dialogs.length+' dialogs');
