/** Local acceptance server, using a copy of the desktop database. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'outputs/neobrutalism');fs.mkdirSync(output,{recursive:true});
const databasePath=path.join(output,'test.db');
if(!process.argv.includes('--reuse')) {
  const configDir=path.join(process.env.APPDATA,'byqx-blog-desktop');
  const config=JSON.parse(fs.readFileSync(path.join(configDir,'config.json'),'utf8'));
  const source=new Database(config.LOCAL_DB_PATH||path.join(configDir,'blog-local.db'),{readonly:true});
  try { await source.backup(databasePath); } finally { source.close(); }
}
if(!fs.existsSync(databasePath)) throw Error('Missing isolated database; run without --reuse first.');
const log=fs.openSync(path.join(output,'server.log'),'a');
const child=spawn(process.execPath,[path.join(root,'dist/server/entry.mjs')],{cwd:output,env:{...process.env,HOST:'127.0.0.1',PORT:'43221',DATABASE_URL:'file:'+databasePath,DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL:'',SYNC_DATABASE_URL_FALLBACK:'',ADMIN_PASSWORD:'neobrutalism-local-check',TOP_ADMIN_PASSWORD:'neobrutalism-local-check',AUTH_SECRET:randomBytes(32).toString('hex'),DESKTOP_MODE:'1',SITE_URL:'http://127.0.0.1:43221'},stdio:['ignore',log,log]});
child.on('exit',code=>{fs.closeSync(log);process.exit(code||0);});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill());
for(let attempt=0;attempt<40;attempt++) {try {const r=await fetch('http://127.0.0.1:43221/api/ui-style',{signal:AbortSignal.timeout(2000)});if(r.ok){console.log('NEOBRUTALISM_ISOLATED_SERVER_READY');break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));if(attempt===39){child.kill();throw Error('Local review server did not start.');}}
