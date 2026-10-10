/** Clear only isolated browser sessions via Electron's storage API; keep directories. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),outputs=path.join(root,'outputs');
const profiles=[];
for(const folder of ['completion-desktop','interaction-desktop']){
  const base=path.join(outputs,folder);
  for(const item of fs.readdirSync(base,{withFileTypes:true}))if(item.isDirectory() && /^profile(?:-\d+)?$/.test(item.name))profiles.push(path.join(base,item.name));
  const config=path.join(base,'appdata/byqx-blog-desktop/config.json');
  if(fs.existsSync(config))fs.writeFileSync(config,'{}\n');
}
const oldProfile=path.join(outputs,'material3-review/repair-1.1.1/zoom-profile-a1p5q5');if(fs.existsSync(oldProfile))profiles.push(oldProfile);
const wrapper=path.join(outputs,'clear-review-storage');fs.mkdirSync(wrapper,{recursive:true});
fs.writeFileSync(path.join(wrapper,'package.json'),JSON.stringify({name:'clear-isolated-review-storage',version:'1.0.0',main:'main.cjs'}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
for(const profile of profiles){
  assert.ok(path.resolve(profile).startsWith(outputs+path.sep));
  fs.writeFileSync(path.join(wrapper,'main.cjs'),`const{app,session}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{await session.defaultSession.clearStorageData();await session.defaultSession.clearCache();console.log('REVIEW_STORAGE_CLEARED');app.exit(0);}).catch(e=>{console.error(e);app.exit(1);});`);
  const result=execFileSync(path.join(root,'node_modules/electron/dist/electron.exe'),[wrapper],{env,windowsHide:true,encoding:'utf8',timeout:30000});
  assert.match(result,/REVIEW_STORAGE_CLEARED/);
}
const report=JSON.parse(fs.readFileSync(path.join(outputs,'test-data-cleanup.json'),'utf8').replace(/^\uFEFF/,''));
report.isolatedBrowserStorageCleared=profiles.map(file=>path.relative(root,file));
fs.writeFileSync(path.join(outputs,'test-data-cleanup.json'),JSON.stringify(report,null,2));
console.log(`REVIEW_BROWSER_STORAGE_CLEARED profiles=${profiles.length}`);
