/** Labelled acceptance examples only; explicitly refuses any other database path. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const out=path.resolve('outputs/discovery-workspace');
const meta=JSON.parse(fs.readFileSync(path.join(out,'server.json'),'utf8'));
assert.equal(meta.databasePath,path.join(out,'test.db'));
const db=new Database(meta.databasePath);
const fixture={categories:['review-dev','review-learn','review-design','review-empty'],oldestDate:'2026-09-26',photoTotal:65};
try {
  db.transaction(()=>{
    // These deletes affect the copied acceptance DB, never the user's actual content.
    db.prepare('DELETE FROM websites').run();db.prepare('DELETE FROM nav_sub_categories').run();db.prepare('DELETE FROM web_categories').run();db.prepare('DELETE FROM photos').run();
    const now=Date.now();
    const cat=db.prepare('INSERT INTO web_categories (id,name,icon,sort,created_at,updated_at) VALUES (?,?,NULL,?,?,?)');
    ['开发工具','学习资源','设计灵感','空分类'].forEach((name,i)=>cat.run(fixture.categories[i],'验收示例 · '+name,i,now,now));
    db.prepare('INSERT INTO nav_sub_categories (id,category_id,name,sort,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('review-sub','review-dev','文档与工具',0,now,now);
    const site=db.prepare('INSERT INTO websites (id,category_id,sub_category_id,name,url,icon,desc,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const names=['GitHub','MDN Web Docs','Astro','TypeScript','Figma','Blender','Cloudflare','开发工具与长标题的换行效果验收','阅读与笔记'];
    names.forEach((name,i)=>site.run('review-site-'+i,fixture.categories[i%3],i===0?'review-sub':null,name,'https://example.invalid/site-'+i,'/images/neobrutalism/cat-peek.webp','验收示例 · 收藏值得再次打开的网站与学习资源。',i,now,now));
    const photo=db.prepare('INSERT INTO photos (id,url,thumb_url,title,tags,width,height,taken_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<65;i++) {
      const taken=new Date(2026,9,8-Math.floor(i/5),12).getTime();
      photo.run('review-photo-'+i,'/images/neobrutalism/article-fallback.webp','/images/neobrutalism/article-fallback.webp',i===4?'':(i===3?'验收示例 · 长标题的照片记录与多行排版检查':'验收示例 · 日常记录 '+(i+1)),JSON.stringify(['验收示例',i%2?'生活':'风景']),941,i%3===0?1200:650,taken,now-i,now);
    }
  })();
} finally { db.close(); }
fs.writeFileSync(path.join(out,'fixtures.json'),JSON.stringify(fixture,null,2));
console.log('Isolated discovery fixtures: 4 categories, 9 sites, 65 photos');
