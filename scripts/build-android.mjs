import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { download } from './setup-android.mjs';
import { androidJavaHome } from './android-java.mjs';

const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const java=androidJavaHome();
const env={...process.env,JAVA_HOME:java,ANDROID_BUILD:'1',ASTRO_TELEMETRY_DISABLED:'1'};
const run=(cmd,args,options={})=>execFileSync(cmd,args,{stdio:'inherit',env,...options});
fs.mkdirSync('android/signing',{recursive:true});
const passwordFile='android/signing/password.txt';
if(!fs.existsSync(passwordFile))fs.writeFileSync(passwordFile,crypto.randomBytes(32).toString('base64url'),{mode:0o600});
env.BYQX_ANDROID_STORE_PASSWORD=fs.readFileSync(passwordFile,'utf8').trim();
if(!fs.existsSync('android/signing/byqx.jks'))run(path.join(java,'bin/keytool.exe'),['-genkeypair','-keystore','android/signing/byqx.jks','-storepass:env','BYQX_ANDROID_STORE_PASSWORD','-keypass:env','BYQX_ANDROID_STORE_PASSWORD','-alias','byqx','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Byqx Personal Android,O=Byqx,C=CN']);
fs.writeFileSync('android/local.properties',`sdk.dir=${path.join(root,'.android-tools/sdk').replaceAll('\\','/').replace(':','\\:')}\n`);
const abiMap={'arm64-v8a':'arm64','x86_64':'x64'};
// Published SHA256 values pinned with the version; rebuilding must not require GitHub API quota.
// https://github.com/digidem/better-sqlite3-nodejs-mobile/releases/expanded_assets/13.0.3
const sqliteDigests={arm64:'8c1b945bf20207f588bfb329251e5748fe18dc8f0b8937b97a2b687db8bbab30',x64:'02bc592324f788fa7492e3ec0d88aae011e7ab74c99452fbf4c3f2b13fbc782e'};
fs.mkdirSync('android/app/libnode',{recursive:true});
fs.cpSync('.android-tools/node24/include','android/app/libnode/include',{recursive:true});
for(const [abi,arch] of Object.entries(abiMap)) {
  const native=`android/app/src/main/jniLibs/${abi}`;fs.mkdirSync(native,{recursive:true});
  fs.copyFileSync(`.android-tools/node24/bin/${abi}/libnode.so`,`${native}/libnode.so`);
  const filename=`better-sqlite3-13.0.3-android-${arch}.tar.gz`;
  const archive=await download(`https://github.com/digidem/better-sqlite3-nodejs-mobile/releases/download/13.0.3/${filename}`,filename,sqliteDigests[arch]);
  const extraction=`.android-tools/sqlite-${arch}`;fs.mkdirSync(extraction,{recursive:true});run('tar',['-xf',archive,'-C',extraction]);
  const find=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory()){const match=find(file);if(match)return match;}else if(e.name.endsWith('.node'))return file;}};
  const binding=find(extraction);if(!binding)throw Error('SQLite 原生库缺失');fs.copyFileSync(binding,`${native}/libbetter_sqlite3.so`);
}
fs.mkdirSync('android/app/src/main/res/mipmap-xxxhdpi',{recursive:true});fs.copyFileSync('build/icon.png','android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
run(process.execPath,['node_modules/astro/bin/astro.mjs','build']);
run('cmd.exe',['/d','/c','npm install --prefix .android-tools/wasm --ignore-scripts --force --no-audit --no-fund @img/sharp-wasm32@0.35.4']);
run(process.execPath,['scripts/package-android-runtime.mjs']);
let gradle=process.env.BYQX_GRADLE;
if(!gradle) {
  const base=path.join(process.env.USERPROFILE,'.gradle/wrapper/dists/gradle-8.13-bin');
  for(const hash of fs.existsSync(base)?fs.readdirSync(base):[]) {const candidate=path.join(base,hash,'gradle-8.13/bin/gradle.bat');if(fs.existsSync(candidate)){gradle=candidate;break;}}
}
if(!gradle) {const digest=await fetch('https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256').then(r=>r.text());if(!/^[a-f0-9]{64}$/.test(digest.trim()))throw Error('Gradle 发布摘要无效');const archive=await download('https://services.gradle.org/distributions/gradle-8.13-bin.zip','gradle-8.13-bin.zip',digest.trim());run('tar',['-xf',archive,'-C','.android-tools']);gradle=path.join(root,'.android-tools/gradle-8.13/bin/gradle.bat');}
const gradleLib=path.resolve(path.dirname(gradle),'../lib');
const launcher=fs.readdirSync(gradleLib).find(name=>/^gradle-(gradle-cli-main|launcher)-8\.13\.jar$/.test(name));
if(!launcher)throw Error('Gradle launcher 缺失');
run(path.join(java,'bin/java.exe'),['-classpath',path.join(gradleLib,launcher),'org.gradle.launcher.GradleMain','--no-daemon','--console=plain','assembleRelease'],{cwd:path.join(root,'android')});
run(path.join(java,'bin/java.exe'),['-jar','.android-tools/sdk/build-tools/35.0.0/lib/apksigner.jar','verify','--verbose','android/app/build/outputs/apk/release/app-release.apk']);
const releaseDir=path.join(root,'release/android');fs.mkdirSync(releaseDir,{recursive:true});
const metadata=JSON.parse(fs.readFileSync('android/app/build/outputs/apk/release/output-metadata.json','utf8'));
const version=metadata.elements[0]?.versionName;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('APK 版本信息无效');
const apk=path.join(releaseDir,`白衣卿相-Android-${version}.apk`);fs.copyFileSync('android/app/build/outputs/apk/release/app-release.apk',apk);
fs.writeFileSync(path.join(releaseDir,'apk.sha256'),crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex')+'\n');
fs.copyFileSync('docs/Android/03-开发手册.md',path.join(releaseDir,'使用说明.md'));
fs.copyFileSync('docs/Android/04-启动故障修复.md',path.join(releaseDir,'04-启动故障修复.md'));
console.log(`APK 已构建: ${apk}`);
