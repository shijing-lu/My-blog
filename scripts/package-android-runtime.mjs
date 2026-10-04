import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import ts from 'typescript';
import { androidJavaHome } from './android-java.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.android-tools', `payload-${Date.now()}`);
const req = createRequire(import.meta.url);
const scan = (dir, roots = new Set()) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir,e.name);
    if(e.isDirectory()) scan(file,roots);
    else if(/\.[cm]?js$/.test(e.name)) {
      const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      const add=(value)=>{if(value.startsWith('.') || value.startsWith('/') || value.includes(':'))return; const parts=value.split('/'); roots.add(value.startsWith('@')?parts.slice(0,2).join('/'):parts[0]);};
      const visit=(node)=>{
        if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier.text);
        if(ts.isCallExpression(node)&&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0])&&((ts.isIdentifier(node.expression)&&node.expression.text==='require')||node.expression.kind===ts.SyntaxKind.ImportKeyword)) add(node.arguments[0].text);
        ts.forEachChild(node,visit);
      };visit(source);
    }
  }return roots;
};
function resolve(name,from) {
  for(let scope=from;scope.startsWith(ROOT);scope=path.dirname(scope)) {
    const p=path.join(scope,'node_modules',name);
    if(fs.existsSync(path.join(p,'package.json'))) return fs.realpathSync(p);
    if(scope===path.dirname(scope))break;
  }
  const entry=req.resolve(name,{paths:[from]}); let p=path.dirname(entry);
  while(p!==path.dirname(p)) { if(fs.existsSync(path.join(p,'package.json'))&&JSON.parse(fs.readFileSync(path.join(p,'package.json'))).name===name)return p; p=path.dirname(p); }
  throw new Error(`无法解析依赖 ${name}`);
}
function copyPackage(source,dest) {
  fs.cpSync(source,dest,{recursive:true,dereference:true,filter:(file)=>{
    const rel=path.relative(source,file);const parts=rel.split(path.sep);
    return !parts.some(p=>['node_modules','test','tests','.git'].includes(p)) && !/\.(map|ts|cts|mts|node|exe|dll|lib|pdb|cc|cpp|h|gyp)$/.test(rel);
  }});
}
fs.mkdirSync(OUT,{recursive:true});
const template = path.join(ROOT,'desktop/assets/template.db');
const TemplateDatabase = req('better-sqlite3');
const templateDb = new TemplateDatabase(template,{readonly:true,fileMustExist:true});
try {
  for(const {name} of templateDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const count=templateDb.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"','""')}"`).get().n;
    if(count!==0)throw Error(`空库模板 ${name} 含数据，拒绝将个人数据打入 APK`);
  }
} finally { templateDb.close(); }
fs.cpSync(path.join(ROOT,'.android-tools/dist'),path.join(OUT,'dist'),{recursive:true});
fs.copyFileSync(path.join(ROOT,'android/runtime/main.cjs'),path.join(OUT,'main.cjs'));
fs.copyFileSync(path.join(ROOT,'desktop/assets/template.db'),path.join(OUT,'template.db'));
fs.writeFileSync(path.join(OUT,'package.json'),JSON.stringify({type:'module',private:true}));
const roots=[...scan(path.join(OUT,'dist/server')),'better-sqlite3','drizzle-orm/better-sqlite3','sharp'];
const queue=[];const installed=new Set();
function install(source,dest) {
  if(installed.has(dest))return;installed.add(dest);
  copyPackage(source,dest);queue.push([source,dest]);
}
for(const name of new Set(roots)) {
  const pkg=name.startsWith('drizzle-orm/')?'drizzle-orm':name;
  install(resolve(pkg,ROOT),path.join(OUT,'node_modules',pkg));
}
install(resolve('@img/sharp-wasm32',path.join(ROOT,'.android-tools/wasm')),path.join(OUT,'node_modules/@img/sharp-wasm32'));
for(let i=0;i<queue.length;i++) {
  const [source,dest]=queue[i]; const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
  for(const name of Object.keys(pkg.dependencies||{})) {
    const dep=resolve(name,source);const version=JSON.parse(fs.readFileSync(path.join(dep,'package.json'))).version;
    let scope=dest;let found=false;
    while(scope.startsWith(OUT)) {
      const existing=path.join(scope,'node_modules',name,'package.json');
      if(fs.existsSync(existing)){found=JSON.parse(fs.readFileSync(existing)).version===version;break;}
      scope=path.dirname(scope);
    }
    if(found)continue;
    const rootDest=path.join(OUT,'node_modules',name);
    install(dep,fs.existsSync(rootDest)?path.join(dest,'node_modules',name):rootDest);
  }
}
// Generated copy only: force the APK-packaged N-API addon, never a Windows binding.
for(const [,dest] of queue) {
  const pkg=JSON.parse(fs.readFileSync(path.join(dest,'package.json')));
  if(pkg.name==='better-sqlite3') {
    const file=path.join(dest,'lib/binding.js');let code=fs.readFileSync(file,'utf8');
    code=code.replace('function getBinding(nativeBinding) {',`function getBinding(nativeBinding) {\n if(process.env.ANDROID_MODE === '1' && !nativeBinding) { if(!DEFAULT_ADDON) { const binding={exports:{}}; process.dlopen(binding,process.env.BYQX_SQLITE_NATIVE); DEFAULT_ADDON=binding.exports; } return DEFAULT_ADDON; }`);
    fs.writeFileSync(file,code);
  }
}
const entry=path.join(OUT,'dist/server/entry.mjs');let code=fs.readFileSync(entry,'utf8');
const marker='\tconst key = decodeKey(serializedManifest.key);';
if(!code.includes(marker))throw Error('Astro manifest 结构已变化');
code=code.replace(marker,`${marker}\n\tconst runtimeAppRoot = new URL('../../', import.meta.url);`);
for(const [key,value] of Object.entries({rootDir:'runtimeAppRoot',srcDir:'new URL("src/", runtimeAppRoot)',publicDir:'new URL("dist/client/", runtimeAppRoot)',outDir:'new URL("dist/", runtimeAppRoot)',cacheDir:'new URL(".astro/", runtimeAppRoot)',buildClientDir:'new URL("dist/client/", runtimeAppRoot)',buildServerDir:'new URL("dist/server/", runtimeAppRoot)'})) {
  const from=`${key}: new URL(serializedManifest.${key}),`;
  if(!code.includes(from)) throw Error(`Astro manifest 缺少 ${key}`);
  code=code.replace(from,`${key}: ${value},`);
}
code=code.replace('\t\t...serializedManifest,','\t\t...serializedManifest,\n\t\tsessionConfig: { ...serializedManifest.sessionConfig, options: { ...serializedManifest.sessionConfig.options, base: path.join(process.env.APPDATA, "byqx-blog-desktop", "sessions") } },');
fs.writeFileSync(entry,code);
const assets=path.join(ROOT,'android/app/src/main/assets');fs.mkdirSync(assets,{recursive:true});
const archive=path.join(assets,'runtime.zip');
const javaHome=androidJavaHome();
execFileSync(path.join(javaHome,'bin/jar.exe'),['--create','--file',archive,'--no-manifest','-C',OUT,'.']);
fs.writeFileSync(path.join(assets,'runtime-id.txt'),crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
console.log(`Android 运行载荷完成，${installed.size} 个包，${Math.round(fs.statSync(archive).size/1024/1024)} MB`);
