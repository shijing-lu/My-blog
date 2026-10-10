import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { download } from './setup-android.mjs';
import { androidJavaHome } from './android-java.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sdk = path.join(root, '.android-tools/sdk');
const nativeRoot = path.join(root, 'android-native');
const gradleVersion = '9.6.0';
const gradleSha = 'bbaeb2fef8710818cf0e261201dab964c572f92b942812df0c3620d62a529a01';
if (!fs.existsSync(path.join(sdk, 'licenses/android-sdk-license'))) {
    throw new Error('请先运行 setup:android，完成 Android SDK 许可确认。');
}
const response = await fetch('https://dl.google.com/android/repository/repository2-3.xml');
if (!response.ok) throw new Error('读取官方 SDK 清单失败');
const xml = await response.text();
async function installSdk(packagePath) {
    const target = path.join(sdk, ...packagePath.split(';'));
    const block = xml.split(`<remotePackage path="${packagePath}">`)[1]?.split('</remotePackage>')[0];
    if (!block) throw new Error(`SDK 清单缺少 ${packagePath}`);
    function writeMetadata() {
        // source.properties alone is insufficient for SDK 37's decimal API identifiers.
        const namespaces = xml.match(/<sdk:sdk-repository([^>]+)>/)?.[1];
        const license = xml.match(/<license[^>]*id="android-sdk-license"[^>]*>[\s\S]*?<\/license>/)?.[0];
        if (!namespaces || !license) throw new Error('SDK 清单缺少元数据命名空间或许可');
        const local = block.replace(/<archives>[\s\S]*?<\/archives>/, '').replace(/<channelRef[^>]*\/>/, '');
        fs.writeFileSync(path.join(target, 'package.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<common:repository${namespaces}>\n${license}\n<localPackage path="${packagePath}" obsolete="false">${local}</localPackage>\n</common:repository>\n`);
    }
    if (fs.existsSync(path.join(target, 'source.properties'))) {
        if (!fs.existsSync(path.join(target, 'package.xml'))) writeMetadata();
        return;
    }
    const archives = [...block.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map(m => m[1]);
    const archive = archives.find(a => a.includes('<host-os>windows</host-os>')) ?? archives.find(a => !a.includes('<host-os>'));
    const name = archive?.match(/<url>(.*?)<\/url>/)?.[1];
    const digest = archive?.match(/<checksum[^>]*>(.*?)<\/checksum>/)?.[1];
    if (!name || !/^[a-f0-9]{40}$/.test(digest ?? '')) throw new Error(`SDK 发布校验缺失: ${packagePath}`);
    console.log(`下载 SDK ${packagePath}`);
    const zip = await download(`https://dl.google.com/android/repository/${name}`, name, digest, 'sha1');
    const staging = path.join(root, '.android-tools/extract', `native-${packagePath.replaceAll(';', '-')}`);
    fs.mkdirSync(staging, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', staging]);
    const source = fs.readdirSync(staging).map(n => path.join(staging, n)).find(p => fs.existsSync(path.join(p, 'source.properties')));
    if (!source) throw new Error('SDK 解压目录不符合预期');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    writeMetadata();
    console.log(`已安装 ${packagePath}`);
}
await Promise.all([installSdk('platforms;android-37.0'), installSdk('build-tools;36.0.0')]);
const gradleRoot = path.join(root, `.android-tools/gradle-${gradleVersion}`);
if (!fs.existsSync(path.join(gradleRoot, 'bin/gradle.bat'))) {
    console.log(`下载 Gradle ${gradleVersion}`);
    const zip = await download(`https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`, `gradle-${gradleVersion}-bin.zip`, gradleSha);
    execFileSync('tar', ['-xf', zip, '-C', path.join(root, '.android-tools')]);
}
fs.writeFileSync(path.join(nativeRoot, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/').replace(':', '\\:')}\n`);
// Invoke Java directly so spaces in JDK/Gradle paths do not depend on cmd quoting.
const launcher = fs.readdirSync(path.join(gradleRoot, 'lib')).find(n => /^gradle-(gradle-cli-main|launcher)-.*\.jar$/.test(n));
if (!launcher) throw new Error('Gradle launcher 缺失');
if (!fs.existsSync(path.join(nativeRoot, 'gradlew.bat'))) {
    execFileSync(path.join(androidJavaHome(), 'bin/java.exe'), ['-classpath', path.join(gradleRoot, 'lib', launcher), 'org.gradle.launcher.GradleMain', 'wrapper', '--gradle-version', gradleVersion, '--gradle-distribution-sha256-sum', gradleSha, '--console=plain'], { cwd: nativeRoot, stdio: 'inherit', env: { ...process.env, JAVA_HOME: androidJavaHome() } });
}
console.log('原生工具链就绪');
