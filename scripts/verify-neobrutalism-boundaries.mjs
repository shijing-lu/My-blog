/** Fixture-only checks. Mutations are confined to a second disposable database. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), output=path.join(root,'outputs/neobrutalism');
const dbPath=path.join(output,'boundary-test.db');
assert.ok(dbPath.startsWith(output+path.sep));
const source=new Database(path.join(output,'test.db'),{readonly:true});
try {await source.backup(dbPath);}finally{source.close();}
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];let child;
async function serve() {
  child=spawn(process.execPath,[path.join(root,'dist/server/entry.mjs')],{cwd:output,env:{...process.env,HOST:'127.0.0.1',PORT:'43222',DATABASE_URL:'file:'+dbPath,DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL:'',SYNC_DATABASE_URL_FALLBACK:'',DESKTOP_MODE:'1',AUTH_SECRET:'isolated-boundary-test',ADMIN_PASSWORD:'local-boundary-only'},stdio:'ignore'});
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:43222/api/ui-style')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Fixture server unavailable');
}
async function stop(){if(!child || child.exitCode!==null)return;const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}
const check=(condition,name)=>{assert.ok(condition,name);results.push(name);};
try {
  const db=new Database(dbPath);db.exec('PRAGMA foreign_keys=OFF; DELETE FROM articles');db.prepare('DELETE FROM settings WHERE key=?').run('hero_quotes');db.close();await serve();
  const p=await browser.newPage({viewport:{width:941,height:950},reducedMotion:'reduce'});await p.goto('http://127.0.0.1:43222/',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);
  check(await p.locator('#post-grid .post-row').count()===0,'empty article collection');check((await p.locator('.neo-empty:not(#search-empty)').innerText()).includes('还没有文章'),'empty collection message');check((await p.locator('#hero-quote').innerText()).replaceAll('\n','')==='无路请缨，等终军之弱冠。有怀投笔，慕宗悫之长风。','default reference quote');check((await p.locator('.neo-metric strong').allTextContents()).every(n=>n==='0'),'empty activity totals are zero');await p.screenshot({path:path.join(output,'boundary-empty.png'),fullPage:true});await p.close();await stop();
  // Restore from the isolated copy; do not touch the source desktop database.
  const restore=new Database(path.join(output,'test.db'),{readonly:true});try{await restore.backup(dbPath);}finally{restore.close();}
  const fixture=new Database(dbPath);const longText='长诗词应当保持完整，可阅读且不会造成页面横向溢出。'.repeat(5);
  fixture.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('hero_quotes',JSON.stringify({quotes:[{text:longText,pauseMs:600},{text:'整句轮播验证，文字完整显示。',pauseMs:600}],defaultPauseMs:600,charIntervalMs:480}),Date.now());
  fixture.prepare('UPDATE articles SET title=?, encrypted=1, cover=NULL WHERE id=(SELECT id FROM articles ORDER BY updated_at DESC LIMIT 1)').run('长标题边界：'.repeat(25));fixture.close();await serve();
  const long=await browser.newPage({viewport:{width:360,height:950},reducedMotion:'reduce'});await long.goto('http://127.0.0.1:43222/',{waitUntil:'networkidle'});check(await long.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'long poem and title do not overflow phone');check((await long.locator('#hero-quote').textContent())===longText,'long poem is preserved');check(await long.locator('#post-grid .neo-encrypted').count()===1,'encrypted SSR row is marked');check(await long.locator('.neo-post-cover').first().getAttribute('src')==='/images/neobrutalism/article-fallback.webp','null cover uses fallback');await long.screenshot({path:path.join(output,'boundary-long-360.png'),fullPage:true});const before=await long.locator('#hero-quote').textContent();await long.waitForTimeout(1000);check(await long.locator('#hero-quote').textContent()===before,'reduced motion stops automatic quote rotation');
  await long.emulateMedia({reducedMotion:'no-preference'});await long.waitForFunction(()=>document.getElementById('hero-quote')?.textContent==='整句轮播验证，文字完整显示。');check(true,'configured dwell interval and whole-sentence rotation');await long.emulateMedia({reducedMotion:'reduce'});const stopped=await long.locator('#hero-quote').textContent();await long.waitForTimeout(1000);check(await long.locator('#hero-quote').textContent()===stopped,'enabling reduced motion stops an active timer');await long.close();
} finally {await stop();await browser.close();fs.writeFileSync(path.join(output,'boundaries.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({checks:results.length,results},null,2));
