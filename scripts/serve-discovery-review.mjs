/** Local acceptance server with a copied database and no live image-storage credentials. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
const root = path.resolve(import.meta.dirname,'..');
const output = path.join(root,'outputs/discovery-workspace');
fs.mkdirSync(output,{recursive:true});
const databasePath=path.join(output,'test.db');
if(!fs.existsSync(databasePath)) {
  const source=new Database(path.join(root,'outputs/schedule-workspace/test.db'),{readonly:true});
  try { await source.backup(databasePath); } finally { source.close(); }
  const copy=new Database(databasePath);
  try { copy.prepare("DELETE FROM settings WHERE key='image_bed'").run(); } finally { copy.close(); }
}
const port=43227;
const log=fs.openSync(path.join(output,'server.log'),'a');
const child=spawn(process.execPath,[path.join(root,'dist/server/entry.mjs')],{
  cwd:output,windowsHide:true,
  env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_URL:'file:'+databasePath,
    DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL:'',SYNC_DATABASE_URL_FALLBACK:'',
    BYQX_CONFIG_PATH:path.join(output,'local-config.json'),
    R2_ACCOUNT_ID:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET:'',R2_PUBLIC_BASE_URL:'',
    ADMIN_PASSWORD:'article-review-local',TOP_ADMIN_PASSWORD:'article-review-local',
    AUTH_SECRET:randomBytes(32).toString('hex'),DESKTOP_MODE:'1',SITE_URL:`http://127.0.0.1:${port}`},
  stdio:['ignore',log,log],
});
fs.writeFileSync(path.join(output,'server.json'),JSON.stringify({pid:child.pid,port,databasePath},null,2));
child.on('exit',code=>{fs.closeSync(log);process.exit(code||0);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
for(let i=0;i<40;i++) {
  try { if((await fetch(`http://127.0.0.1:${port}/api/ui-style`,{signal:AbortSignal.timeout(1500)})).ok) { console.log(`DISCOVERY_REVIEW_READY http://127.0.0.1:${port}/nav`); break; } } catch {}
  await new Promise(resolve=>setTimeout(resolve,500));
  if(i===39){child.kill();throw Error('Discovery preview failed');}
}
