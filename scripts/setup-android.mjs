import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { androidJavaHome } from './android-java.mjs';

const root = path.resolve(import.meta.dirname, '..');
const tools = path.join(root, '.android-tools');
const downloads = path.join(tools, 'downloads');
fs.mkdirSync(downloads, { recursive: true });
const hash = (file, algorithm) => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
export async function download(url, name, digest, algorithm = 'sha256') {
  const file = path.join(downloads, name);
  if (!fs.existsSync(file) || (digest && hash(file, algorithm) !== digest)) {
    const tmp = file + '.download';
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`下载失败 ${response.status}: ${name}`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp));
        if (digest && hash(tmp, algorithm) !== digest) throw new Error(`下载校验不符: ${name}`);
        fs.renameSync(tmp, file); error = null; break;
      } catch (e) { error = e; }
    }
    if (error) throw error;
  }
  return file;
}

async function sdkPackage(folder, zip, checksum) {
  const target = path.join(tools, 'sdk', folder);
  if (fs.existsSync(path.join(target, 'source.properties'))) return;
  const file = await download(`https://dl.google.com/android/repository/${zip}`, zip, checksum, 'sha1');
  const temp = path.join(tools, 'extract', folder.replaceAll('/', '-'));
  fs.mkdirSync(temp, { recursive: true });
  execFileSync('tar', ['-xf', file, '-C', temp]);
  const entries = fs.readdirSync(temp).filter(x => fs.statSync(path.join(temp,x)).isDirectory());
  const from = entries.length === 1 ? path.join(temp, entries[0]) : temp;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(from, target, { recursive: true });
  console.log(`SDK 已就绪: ${folder}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const commandline = path.join(tools,'sdk/cmdline-tools/latest');
  if(!fs.existsSync(path.join(commandline,'lib/sdkmanager-classpath.jar'))) {
    const archive=await download('https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip','commandline.zip','90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a');
    const temp=path.join(tools,'commandline-extract');fs.mkdirSync(temp,{recursive:true});execFileSync('tar',['-xf',archive,'-C',temp]);
    fs.mkdirSync(commandline,{recursive:true});fs.cpSync(path.join(temp,'cmdline-tools'),commandline,{recursive:true});
  }
  if(!fs.existsSync(path.join(tools,'sdk/licenses/android-sdk-license'))) {
    const result=spawnSync(path.join(androidJavaHome(),'bin/java.exe'),['-Dcom.android.sdklib.toolsdir='+commandline,'-classpath',path.join(commandline,'lib/sdkmanager-classpath.jar'),'com.android.sdklib.tool.sdkmanager.SdkManagerCli','--sdk_root='+path.join(tools,'sdk'),'--licenses'],{stdio:'inherit'});
    if(result.status!==0 || !fs.existsSync(path.join(tools,'sdk/licenses/android-sdk-license')))throw Error('请先完成 Android SDK 许可确认，再重新运行 setup:android');
  }
  await Promise.all([
    sdkPackage('platforms/android-36', 'platform-36_r02.zip', '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576'),
    sdkPackage('build-tools/35.0.0', 'build-tools_r35_windows.zip', 'af059bb67cf7786f45ee0db85e2d24985df1b4b6'),
    sdkPackage('ndk/27.2.12479018', 'android-ndk-r27c-windows.zip', 'ac5f7762764b1f15341094e148ad4f847d050c38'),
    sdkPackage('cmake/3.22.1', 'cmake-3.22.1-windows.zip', '292778f32a7d5183e1c49c7897b870653f2d2c1b'),
    sdkPackage('platform-tools', 'platform-tools_r37.0.1-win.zip', 'e03e78b1d80b396f1c3358e31251cb31740e1110'),
  ]);
  const release = await fetch('https://api.github.com/repos/digidem/nodejs-mobile/releases/tags/v24.20.0-0').then(r => r.json());
  const asset = release.assets.find(x => x.name === 'nodejs-mobile-android-24.20.0-0.zip');
  if (!asset?.digest?.startsWith('sha256:')) throw new Error('Node 运行时缺少发布 SHA256');
  const archive = await download(asset.browser_download_url, 'node24.zip', asset.digest.slice(7));
  const native = path.join(tools, 'node24'); fs.mkdirSync(native, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', native]);
  fs.writeFileSync(path.join(tools,'node24-source.json'), JSON.stringify({ url: asset.browser_download_url, sha256: asset.digest.slice(7) }, null, 2));
  console.log('Android 工具链与 Node.js Mobile 24 就绪');
}
