/** Export the current desktop database without modifying it. Never include this in the APK. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { androidJavaHome } from './android-java.mjs';

const root=path.resolve(import.meta.dirname,'..');
const desktop=path.join(process.env.APPDATA,'byqx-blog-desktop');
const config=JSON.parse(fs.readFileSync(path.join(desktop,'config.json'),'utf8'));
const source=config.LOCAL_DB_PATH || path.join(desktop,'blog-local.db');
const dir=path.join(root,'release/android');fs.mkdirSync(dir,{recursive:true});
const staging=path.join(root,'.android-tools',`transfer-${Date.now()}`);fs.mkdirSync(staging,{recursive:true});
const Database=createRequire(import.meta.url)('better-sqlite3');
const db=new Database(source,{readonly:true,fileMustExist:true});
try { await db.backup(path.join(staging,'blog-local.db')); } finally { db.close(); }
const snapshot=new Database(path.join(staging,'blog-local.db'));
if(snapshot.pragma('quick_check',{simple:true})!=='ok')throw Error('备份数据库未通过完整性检查');
snapshot.pragma('journal_mode=DELETE');snapshot.close();
const keys=['ADMIN_PASSWORD','TOP_ADMIN_PASSWORD','SYNC_DATABASE_URL','SYNC_DATABASE_URL_FALLBACK','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET','R2_PUBLIC_BASE_URL','R2_S3_ENDPOINT','BLOB_READ_WRITE_TOKEN','PUBLIC_TWIKOO_ENV_ID','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','ADMIN_GITHUB_LOGIN'];
const portable=Object.fromEntries(keys.filter(k=>typeof config[k]==='string').map(k=>[k,config[k]]));
fs.writeFileSync(path.join(staging,'config.json'),JSON.stringify(portable));
if(fs.existsSync(path.join(desktop,'files')))fs.cpSync(path.join(desktop,'files'),path.join(staging,'files'),{recursive:true});
const archive=path.join(root,'.android-tools',`transfer-${Date.now()}.zip`);
const java=androidJavaHome();
execFileSync(path.join(java,'bin/jar.exe'),['--create','--file',archive,'--no-manifest','-C',staging,'.']);
const password=crypto.randomBytes(18).toString('base64url');
const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
const key=crypto.pbkdf2Sync(password,salt,210000,32,'sha256');
const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
const output=path.join(dir,'桌面数据.byqx');
const stream=fs.createWriteStream(output);stream.write(Buffer.concat([Buffer.from('BYQXM01\n'),salt,iv]));
const appendTag=new Transform({transform(chunk,encoding,done){done(null,chunk)},flush(done){this.push(cipher.getAuthTag());done()}});
await pipeline(fs.createReadStream(archive),cipher,appendTag,stream);
fs.writeFileSync(path.join(dir,'迁移口令.txt'),`在手机导入“桌面数据.byqx”时输入以下口令：\n${password}\n\n迁移包包含个人内容与云端凭据，请与口令分开传输，不要公开分享。\n`,{mode:0o600});
// Only the temporary plaintext snapshot created by this script is removed.
fs.rmSync(staging,{recursive:true});fs.unlinkSync(archive);key.fill(0);
console.log(`加密桌面快照已导出，${Math.round(fs.statSync(output).size/1024/1024)} MB。源数据库未修改，口令保存在 release/android/迁移口令.txt。`);
