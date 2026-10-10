/** One-off user-requested cleanup. No fuzzy title matching or cloud access. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const root = path.resolve(import.meta.dirname,'..'), outputs = path.join(root,'outputs');
const desktopDb = path.join(process.env.APPDATA,'byqx-blog-desktop/blog-local.db');
const report = { primaryDeleted:[], isolatedFilesDeleted:[], cleanPreviewCopies:[], templates:[] };
for(const file of [desktopDb,path.join(root,'data/blog.db')]) {
  if(!fs.existsSync(file))continue;
  const db=new Database(file); db.pragma('foreign_keys = ON');
  try {
    db.transaction(()=>{
      const deleted=db.prepare("DELETE FROM admin_applications WHERE id=? AND login=? AND name=?").run('a064772b-938e-456a-aee5-98250f69602d','e2e-visitor','E2E 访客');
      if(deleted.changes)report.primaryDeleted.push({file,table:'admin_applications',id:'a064772b-938e-456a-aee5-98250f69602d',count:deleted.changes});
      const article=db.prepare("SELECT id FROM articles WHERE id=? AND title=? AND content=?").get('353831df-bae6-4978-a0c8-61167b65e49a','发布验收','正文');
      if(article){
        if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_post_categories'").get())db.prepare('DELETE FROM article_post_categories WHERE article_id=?').run(article.id);
        db.prepare('DELETE FROM articles WHERE id=?').run(article.id);
        report.primaryDeleted.push({file,table:'articles',id:article.id,count:1});
      }
    })();
  } finally {db.close();}
}
const isolated = fs.globSync('outputs/**/*.db',{cwd:root}).filter(file=>['test.db','boundary-test.db','empty.db','auth-fixture.db'].includes(path.basename(file)));
for(const relative of isolated) {
  const file=path.resolve(root,relative);assert.ok(file.startsWith(outputs+path.sep));
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(file+suffix)){fs.unlinkSync(file+suffix);report.isolatedFilesDeleted.push(path.relative(root,file+suffix));}
}
// Preserve usable preview URLs with clean copies of the actual desktop database.
const source = new Database(desktopDb,{readonly:true});
try {
  for(const folder of ['neobrutalism','article-workspace','moments-workspace','settings-workspace','schedule-workspace','discovery-workspace','archive-workspace','completion-workspace']) {
    const target=path.join(outputs,folder,'test.db');assert.ok(target.startsWith(outputs+path.sep));
    await source.backup(target);
    const copy=new Database(target);
    try {copy.prepare("DELETE FROM settings WHERE key IN ('image_bed','netdisk')").run();}finally{copy.close();}
    report.cleanPreviewCopies.push(path.relative(root,target));
  }
} finally {source.close();}
// Generated fixture manifests and exports contain test content. Keep screenshots/logs as evidence.
const generated = fs.globSync('outputs/**/*.json',{cwd:root}).filter(file=>/^(?:.*fixtures|acceptance-export|exported-daily|seed-data)\.json$/.test(path.basename(file)));
generated.push(...fs.globSync('outputs/**/map-export.*',{cwd:root}));
for(const relative of generated) {const file=path.resolve(root,relative);assert.ok(file.startsWith(outputs+path.sep));if(fs.existsSync(file)){fs.unlinkSync(file);report.isolatedFilesDeleted.push(relative);}}
for(const relative of ['desktop/assets/template.db','release/portable/resources/desktop-assets/template.db']) {
  const db=new Database(path.join(root,relative),{readonly:true});let total=0;
  try {for(const table of ['articles','doc_nodes','quick_notes','mindmaps','moments','admin_accounts','admin_applications','github_users'])total+=db.prepare('SELECT count(*) AS n FROM '+table).get().n;}finally{db.close();}
  assert.equal(total,0,relative); report.templates.push({file:relative,contentRows:total});
}
fs.writeFileSync(path.join(outputs,'test-data-cleanup.json'),JSON.stringify(report,null,2));
console.log(`TEST_DATA_CLEANED primary=${report.primaryDeleted.reduce((n,row)=>n+row.count,0)} files=${report.isolatedFilesDeleted.length} cleanPreviews=${report.cleanPreviewCopies.length}`);
