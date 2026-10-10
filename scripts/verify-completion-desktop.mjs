/** Packaged desktop payload acceptance; all data and profiles are isolated. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/completion-desktop');
const payload = path.join(root, 'release/portable/resources/app');
const version = JSON.parse(fs.readFileSync(path.join(payload, 'package.json'))).version;
assert.equal(version, '1.1.3');
fs.mkdirSync(out, { recursive: true });
const dbPath = path.join(out, 'test.db'), db = new Database(path.join(root, 'outputs/completion-workspace/test.db'), { readonly: true });
try { await db.backup(dbPath); } finally { db.close(); }
const appData = path.join(out, 'appdata'), profile = path.join(out, 'profile-' + Date.now()), wrapper = path.join(out, 'wrapper');
for (const dir of [path.join(appData, 'byqx-blog-desktop'),profile,wrapper]) fs.mkdirSync(dir, {recursive:true});
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({LOCAL_DB_PATH:dbPath, ADMIN_PASSWORD:'completion-local-only', SYNC_DATABASE_URL:'postgres://unused:unused@127.0.0.1:1/isolated', PORT:'43231'}));
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({name:'completion-desktop-acceptance',version,main:'main.cjs'}));
fs.writeFileSync(path.join(wrapper, 'main.cjs'), `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(payload,'desktop/main.cjs'))});`);
const env = {...process.env,BYQX_START_PATH:'/login?next=%2Fquick-notes',DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL_FALLBACK:'',R2_ACCOUNT_ID:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET:'',R2_PUBLIC_BASE_URL:''};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[wrapper],env,timeout:60000});
const report = {version,packagedPayload:payload,isolatedDatabase:true,cases:[],errors:[]};
try {
  assert.equal(await app.evaluate(({app})=>app.getPath('appData')), appData);
  assert.equal(await app.evaluate(({app})=>app.getVersion()), version);
  const page = await app.firstWindow(); page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:43231/login**',{timeout:60000});
  assert.match(await page.evaluate(()=>navigator.userAgent), /Electron\//);
  // Let startup's anonymous sync check finish before logging in; no cloud access.
  await page.waitForTimeout(4000);
  await page.locator('#login-password').fill('incorrect-review-password'); await page.locator('#login-form button').click(); await page.locator('#login-error').waitFor({state:'visible'});
  await page.locator('#login-password').fill('completion-local-only'); await page.locator('#login-form button').click(); await page.waitForURL('**/quick-notes');
  report.cases.push('Electron 登录错误反馈、成功及 next 跳转');
  for (const route of ['/quick-notes','/admin/auth','/admin/netdisk','/admin/mindmaps','/admin/mindmaps/completion-map-example','/archive','/doc','/calendar','/schedule']) {
    await page.goto('http://127.0.0.1:43231'+route); await page.evaluate(()=>document.fonts.ready);
    await page.locator('h1').first().waitFor();
    assert.equal(await page.locator('h1').count(),1,route);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route);
    if(route.includes('completion-map-example')) {
      await page.locator('[data-map-canvas] svg').first().waitFor();
      await app.evaluate(({BrowserWindow}, target)=>{
        globalThis.__completionDownload = null;
        BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{
          item.setSavePath(target);
          item.once('done',(_done,state)=>{globalThis.__completionDownload=state;});
        });
      },path.join(out,'map-export.svg'));
      await page.locator('#map-export-svg').click();
      for(let i=0;i<100;i++) {
        if(await app.evaluate(()=>globalThis.__completionDownload)==='completed') break;
        if(i===99) throw Error('Electron SVG download did not complete');
        await page.waitForTimeout(100);
      }
      assert.match(fs.readFileSync(path.join(out,'map-export.svg'),'utf8'),/<svg/);
    }
    await page.screenshot({path:path.join(out,route.slice(1).replaceAll('/','-')+'.png')});
    report.cases.push('打包载荷页面：'+route);
  }
  await page.evaluate(()=>{localStorage.setItem('my-blog-theme',JSON.stringify({mode:'dark'}));});
  await page.goto('http://127.0.0.1:43231/quick-notes');
  assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),true);
  await page.screenshot({path:path.join(out,'quick-notes-dark.png')});
  report.cases.push('打包载荷暗色偏好恢复');
  assert.deepEqual(report.errors,[]);
  console.log(`COMPLETION_DESKTOP_OK version=${version} cases=${report.cases.length}`);
} finally {
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await app.close().catch(()=>{});
}
