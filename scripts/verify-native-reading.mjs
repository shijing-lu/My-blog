import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root='http://127.0.0.1:4342';
async function call(path,body,bearer) { const r=await fetch(root+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:body?JSON.stringify(body):undefined}); assert.equal(r.headers.get('cache-control'),'private, no-store'); return {status:r.status,body:await r.json()}; }
assert.equal((await call('/api/mobile/v1/reading/catalog')).status,401);
const auth=await call('/api/mobile/v1/auth/login',{password:'native-owner-fixture-only',deviceId:randomUUID(),deviceName:'reading HTTP fixture'}); assert.equal(auth.status,200);
const token=auth.body.accessToken;const serverId=auth.body.serverId;
const catalog=await call('/api/mobile/v1/reading/catalog',null,token); assert.equal(catalog.status,200);assert.equal(catalog.body.serverId,serverId);assert.equal(catalog.body.articles.length,2);assert.ok(catalog.body.categories.length);
assert.ok(catalog.body.articles.every(a=>!('content' in a) && !('source' in a) && !('encryptMeta' in a)));
const detail=await call('/api/mobile/v1/reading/detail',{serverId,id:'native-reading-open'},token);assert.equal(detail.status,200);assert.ok(detail.body.source.includes(':::tabs#工具'));assert.match(detail.body.sourceVersion,/^[a-f0-9]{64}$/);
for(const password of [undefined,'wrong']) { const locked=await call('/api/mobile/v1/reading/detail',{serverId,id:'native-reading-locked',password},token);assert.equal(locked.status,423);assert.ok(!('source' in locked.body)); }
assert.equal((await call('/api/mobile/v1/reading/detail',{serverId:'wrong',id:'native-reading-open'},token)).status,400);
assert.equal((await call('/api/mobile/v1/reading/detail',{serverId,id:'absent'},token)).status,404);
const unlocked=await call('/api/mobile/v1/reading/detail',{serverId,id:'native-reading-locked',password:'reading-fixture-only'},token);assert.equal(unlocked.status,200);assert.ok(unlocked.body.source.includes('仅正确密码'));
const search=await call('/api/mobile/v1/reading/search?q='+encodeURIComponent('宽表格只在自身区域'),null,token);assert.equal(search.status,200);assert.deepEqual(search.body.articles.map(a=>a.id),['native-reading-open']);assert.ok(search.body.articles.every(a=>!('source' in a)));
const privateSearch=await call('/api/mobile/v1/reading/search?q='+encodeURIComponent('仅正确密码解锁后可读'),null,token);assert.deepEqual(privateSearch.body.articles,[]);
for(const liked of [true,true,false,false]) {const result=await call('/api/mobile/v1/reading/like',{serverId,id:'native-reading-open',liked},token);assert.equal(result.status,200);assert.equal(result.body.liked,liked);assert.equal(result.body.likes,liked?1:0);}
const before=detail.body.views;assert.equal((await call('/api/mobile/v1/reading/view',{serverId,id:'native-reading-open'},token)).body.views,before+1);
console.log('PASS reading HTTP: Bearer guard, private no-store, metadata without source/password hash, source version, wrong password, unlock, server partition, missing article');
