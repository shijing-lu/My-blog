import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { androidJavaHome } from './android-java.mjs';

const root = path.resolve(import.meta.dirname, '..');
const nativeRoot = path.join(root, 'android-native');
const java = path.join(androidJavaHome(), 'bin/java.exe');
const gradleRoot = path.join(root, '.android-tools/gradle-9.6.0');
if (!fs.existsSync(gradleRoot)) throw new Error('先运行 node scripts/setup-android-native.mjs');
const launcher = fs.readdirSync(path.join(gradleRoot, 'lib')).find(n => /^gradle-(gradle-cli-main|launcher)-.*\.jar$/.test(n));
if (!launcher) throw new Error('Gradle launcher 缺失');
const args = process.argv.slice(2);
const packageApk = args.includes('--package');
const tasks = args.filter(a => a !== '--package');
if (tasks.length === 0) tasks.push('assembleDebug', 'lintDebug');
execFileSync(java, ['-classpath', path.join(gradleRoot, 'lib', launcher), 'org.gradle.launcher.GradleMain', '--console=plain', ...tasks], {
    cwd: nativeRoot, stdio: 'inherit', env: { ...process.env, JAVA_HOME: androidJavaHome() },
});
if (packageApk) {
    const source = path.join(nativeRoot, 'app/build/outputs/apk/debug/app-debug.apk');
    const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(source), 'output-metadata.json'), 'utf8'));
    if (metadata.applicationId !== 'com.byqx.blog.nativeapp') throw new Error('APK 包名不是独立原生测试版');
    execFileSync(java, ['-jar', path.join(root, '.android-tools/sdk/build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--verbose', source], { stdio: 'inherit' });
    const catalog = fs.readFileSync(path.join(nativeRoot, 'core/model/src/main/kotlin/com/byqx/core/model/FoundationModels.kt'), 'utf8');
    const stage = Number(catalog.match(/const val STAGE = (\d+)/)?.[1]);
    if (!Number.isInteger(stage) || stage < 1 || stage > 16) throw new Error('原生交付阶段无效');
    const folder = path.join(root, `release/android-native/stage-${String(stage).padStart(2, '0')}`);
    fs.mkdirSync(folder, { recursive: true });
    const name = `白衣卿相-原生-阶段${stage}-${metadata.elements[0].versionName}-debug.apk`;
    const file = path.join(folder, name);
    fs.copyFileSync(source, file);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(path.join(folder, 'apk.sha256'), `${sha256}  ${name}\n`);
    console.log(`APK: ${file}\nSHA256: ${sha256}`);
}
