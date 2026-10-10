/** Fixture writes are confined to outputs/article-workspace/test.db, never the user's database. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const out=path.resolve('outputs/article-workspace'),server=JSON.parse(fs.readFileSync(path.join(out,'server.json'),'utf8'));
assert.equal(server.databasePath,path.join(out,'test.db'));assert.equal(server.port,43223);
const base='http://127.0.0.1:43223';
const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'article-review-local'})});assert.ok(login.ok);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function api(url,body){const r=await fetch(base+url,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();}
const source='# 阅读与编辑验收\n\n:spoiler[独立答案甲] 和 :spoiler[独立答案乙]。\n\n## 开始之前\n\n查找唯一暗藏词。\n\n:::note\n提示块内容可编辑\n:::\n\n'+Array.from({length:199},(_,i)=>`${i%3?'###':'##'} ${String(i+2).padStart(3,'0')} ${i===5?'长章节标题：目录、原地编辑、自动保存与多层级结构的完整阅读体验':'实践与记录 '+(i+2)}\n\n第 ${i+2} 节正文，用于真实的长文阅读和目录跳转验收。\n\n`).join('');
const category=(await api('/api/doc/categories',{name:'新风格验收示例'})).category;
const bundle=(await api('/api/doc/bundles',{categoryId:category.id,name:'文章与文档 · 密集目录验收',summary:'300 个节点、六层目录、200 个章节；全部为隔离数据库中的示例。'})).bundle;
const first=(await api('/api/doc/nodes',{bundleId:bundle.id,kind:'article',title:'阅读与原地编辑：长标题及目录密度示例',content:source})).node;
const second=(await api('/api/doc/nodes',{bundleId:bundle.id,kind:'article',title:'第二篇：文章切换与返回',content:'## 返回与切换\n\n第二篇正文，用于文章切换回归。'})).node;
const database=new Database(server.databasePath);
try{
 assert.ok(database.prepare('SELECT id FROM doc_nodes WHERE id=?').get(first.id),'HTTP API and fixture database must match');
 const insert=database.prepare('INSERT INTO doc_nodes (id,bundle_id,parent_id,kind,title,content,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
 database.transaction(()=>{let parent=null;for(let i=0;i<6;i++){const id=`review-${bundle.id}-folder-${i}`;insert.run(id,bundle.id,parent,'folder',`第 ${i+1} 层 · 目录折叠示例`,'',i,Date.now(),Date.now());parent=id;}for(let i=0;i<294;i++)insert.run(`review-${bundle.id}-${i}`,bundle.id,i<8?parent:null,'article',i%13===0?`第 ${i+1} 篇：这是一个很长的标题，用来确认最多两行及键盘焦点的完整标题提示`:`第 ${String(i+1).padStart(3,'0')} 篇 · 知识记录`,'## 示例\n\n隔离验收正文。',i+10,Date.now(),Date.now());})();
}finally{database.close();}
const articles={};for(const type of ['tech','note','photo']){const created=await api('/api/articles',{});const result=await api('/api/save-draft',{id:created.id,title:{tech:'Codex 实战：阅读与写作',note:'把知识写给未来的自己',photo:'山野之间，慢慢看见'}[type],content:type==='photo'?'## 午后的光\n\n![封面示例](/images/neobrutalism/cat-rest.webp)\n\n留下生活里的一小片光。':source,type,tags:['验收示例'],summary:'本地验收示例；不代表真实文章内容。'});articles[type]=result.article;}
const lockedCreated=await api('/api/articles',{});
const locked=(await api('/api/save-draft',{id:lockedCreated.id,title:'受保护的文章 · 本地示例',content:'PRIVATE_REVIEW_SENTINEL\n\n## 解锁之后\n\n受保护正文',type:'note',tags:['验收示例'],encrypt:true,encryptPassword:'review-pass-2026',encryptHint:'本地验收口令'})).article;
fs.writeFileSync(path.join(out,'fixtures.json'),JSON.stringify({bundle:bundle.id,first:first.id,second:second.id,category:category.id,articles,locked},null,2));
console.log('Seeded isolated fixture: 302 nodes, six folders, 200 headings');
