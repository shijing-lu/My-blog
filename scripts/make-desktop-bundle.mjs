/**
 * 组装「自包含」桌面端目录（不依赖源码 / 不依赖 pnpm 软链）
 *
 * 产物：release/portable/（构建成功后覆盖固定目录）
 *   ├─ 白衣卿相.exe            ← Electron 运行时（从 node_modules/electron/dist 复制）
 *   ├─ *.dll / *.pak / locales/
 *   └─ resources/
 *       ├─ app/                ← 应用载荷（编译产物 + 壳 + 依赖闭包）
 *       │   ├─ dist/           Astro 产物（client + server）
 *       │   ├─ desktop/        main.cjs / preload.cjs / assets/template.db
 *       │   ├─ package.json    main 字段指向 desktop/main.cjs
 *       │   └─ node_modules/   运行期依赖（按版本保留嵌套关系，真实文件）
 *       └─ desktop-assets/     模板库与托盘图标（main.cjs 在 isPackaged 布局下读这里）
 *
 * 为什么需要：便携版若用目录联接指向源码，删掉源码就启动失败。
 * 本脚本把所需一切复制进来，产物可整体拷到任何目录（甚至别的机器）运行。
 *
 * 用法：node scripts/make-desktop-bundle.mjs
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
/**
 * 先在 release/.portable-staging-* 临时组装，再将成功产物替换到 release/portable。
 */
const RELEASE = path.join(ROOT, 'release');
const bundleDirName = process.env.BYQX_DESKTOP_BUNDLE_DIR || 'portable';
if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(bundleDirName)) throw new Error('便携包目录名不合法');
const PORTABLE = path.join(RELEASE, bundleDirName);
const OUT = path.join(RELEASE, `.portable-staging-${process.pid}-${Date.now()}`);
const APP = path.join(OUT, 'resources', 'app');
const requireHere = createRequire(import.meta.url);

/**
 * 扫描服务端产物里的**全部外部导入**，据此推导运行期依赖
 *
 * 为什么不手写清单：Astro 会把相当多的包保留为 external（clsx、tailwind-merge、
 * radix、gsap…），手写必然漏（实测漏 clsx 直接启动失败）。扫描产物是唯一可靠来源。
 */
function scanExternalImports(dir, out = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanExternalImports(full, out);
      continue;
    }
    if (!/\.[cm]?js$/.test(entry.name)) continue;
    // 正则会把打包后保留在注释里的 `require('picomatch')` 当成真正
    // 的运行时依赖；按语法树读取导入，忽略注释和字符串中的示例代码。
    const source = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const addSpec = (spec) => {
      if (!spec || spec.includes('${') || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') ||
          spec.startsWith('astro:') || spec.startsWith('data:') || spec.startsWith('file:') ||
          spec.startsWith('http')) return;
      const parts = spec.split('/');
      const name = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      if (name) out.add(name);
    };
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        addSpec(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        if ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          addSpec(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

/** 运行期依赖 = 产物扫描结果 + 惰性 require 的原生模块（变量间接引用，扫描看不到） */
const RUNTIME_ROOTS = [
  ...scanExternalImports(path.join(ROOT, 'dist', 'server')),
  'better-sqlite3',
  'sharp',
].sort();


/**
 * 递归复制包目录（pnpm 友好）
 *
 * 为什么不用 cpSync({dereference:true})：pnpm 包的嵌套 node_modules 里有大量软链，
 * 其中包含未安装的平台包（悬空链接）→ cpSync 解引用会抛 ERR_FS_CP_EINVAL。
 * 这里只复制单个包的真实文件；installPackage 随后按源依赖树复制精确版本到嵌套目录。
 */
function copyPackage(src, dest, depth = 0) {
  const resolved = realpathSync(src);
  if (resolved === ROOT || resolved.startsWith(RELEASE + path.sep)) {
    throw new Error(`拒绝将项目根目录或发行目录复制为依赖包：${resolved}`);
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    let stat = null;
    try {
      stat = statSync(from); // 解引用：软链取目标
    } catch {
      continue; // 悬空软链：跳过
    }
    if (stat.isDirectory()) copyPackage(from, to, depth + 1);
    else copyFileSync(from, to);
  }
}

/** 解析包的真实目录（pnpm 下是 .pnpm/... 的软链目标） */
function namedPackageDir(candidate, name) {
  try {
    const dir = realpathSync(candidate);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === name ? dir : null;
  } catch {
    return null;
  }
}

function resolvePackageDir(name, fromDir) {
  // pnpm 把依赖软链放在包旁边的 node_modules。部分纯 ESM 包不导出
  // package.json，也没有 require 入口，require.resolve 三种探测都会失败。
  // 沿 Node 的查找路径检查真实目录，并校验包名，避免把项目根误当成依赖复制。
  let scope = fromDir;
  while (scope.startsWith(ROOT)) {
    const modules = path.basename(scope) === 'node_modules' ? scope : path.join(scope, 'node_modules');
    const found = namedPackageDir(path.join(modules, ...name.split('/')), name);
    if (found) return found;
    const next = path.dirname(scope);
    if (next === scope) break;
    scope = next;
  }
  try {
    const entry = requireHere.resolve(`${name}/package.json`, { paths: [fromDir] });
    const found = namedPackageDir(path.dirname(entry), name);
    if (found) return found;
  } catch {
    /* 继续尝试其他入口 */
  }
  // 有些平台预编译包只通过自定义导出暴露 package.json。
  try {
    const entry = requireHere.resolve(`${name}/package`, { paths: [fromDir] });
    const found = namedPackageDir(path.dirname(entry), name);
    if (found) return found;
  } catch {
    /* 继续尝试通过包入口定位 */
  }
  // 有些包不导出 package.json：解析主入口再向上找 package.json。
  try {
    let dir = path.dirname(requireHere.resolve(name, { paths: [fromDir] }));
    for (let i = 0; i < 8; i += 1) {
      const found = namedPackageDir(dir, name);
      if (found) return found;
      const next = path.dirname(dir);
      if (next === dir) break;
      dir = next;
    }
  } catch {
    /* 解析失败 */
  }
  return null;
}

/** 读包的 dependencies（含 optionalDependencies 里的平台包，如 sharp 的 @img/*） */
function packageDeps(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return [
      ...Object.keys(pkg.dependencies ?? {}).map((name) => ({ name, optional: false })),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
    ];
  } catch {
    return [];
  }
}

// ── 1) 复制 Electron 运行时到暂存目录 ──────────────────────────────────────
mkdirSync(APP, { recursive: true });
const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
if (!existsSync(electronDist)) {
  console.error('未找到 Electron 运行时（node_modules/electron/dist），请先 pnpm install');
  process.exit(1);
}
cpSync(electronDist, OUT, { recursive: true });
renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, '白衣卿相.exe'));
console.log('✓ Electron 运行时已复制');

// ── 2) 复制应用载荷 ────────────────────────────────────────────────────────
for (const rel of ['dist', 'desktop']) {
  cpSync(path.join(ROOT, rel), path.join(APP, rel), { recursive: true });
}
writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    {
      name: 'my-blog-desktop',
      productName: '白衣卿相',
      version: JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
      private: true,
      main: 'desktop/main.cjs',
      type: 'module',
    },
    null,
    2,
  ),
);
console.log('✓ 应用载荷（dist / desktop / package.json）已复制');

// Astro 的 Node standalone manifest 默认记录构建机上的绝对源码路径。
// 便携包必须从自身目录定位 client/server 产物，否则移走源码后静态资源会失效。
const serverEntry = path.join(APP, 'dist', 'server', 'entry.mjs');
let serverEntryCode = readFileSync(serverEntry, 'utf8');
const manifestRuntimePaths = new Map([
  ['rootDir: new URL(serializedManifest.rootDir),', 'rootDir: runtimeAppRoot,'],
  ['srcDir: new URL(serializedManifest.srcDir),', 'srcDir: new URL("src/", runtimeAppRoot),'],
  ['publicDir: new URL(serializedManifest.publicDir),', 'publicDir: new URL("dist/client/", runtimeAppRoot),'],
  ['outDir: new URL(serializedManifest.outDir),', 'outDir: new URL("dist/", runtimeAppRoot),'],
  ['cacheDir: new URL(serializedManifest.cacheDir),', 'cacheDir: new URL(".astro/", runtimeAppRoot),'],
  ['buildClientDir: new URL(serializedManifest.buildClientDir),', 'buildClientDir: new URL("dist/client/", runtimeAppRoot),'],
  ['buildServerDir: new URL(serializedManifest.buildServerDir),', 'buildServerDir: new URL("dist/server/", runtimeAppRoot),'],
]);
for (const [from, to] of manifestRuntimePaths) {
  if (!serverEntryCode.includes(from)) throw new Error(`Astro standalone manifest layout changed: ${from}`);
  serverEntryCode = serverEntryCode.replace(from, to);
}
const manifestKeyMarker = '\tconst key = decodeKey(serializedManifest.key);';
if (!serverEntryCode.includes(manifestKeyMarker)) throw new Error('Astro standalone manifest initializer changed');
serverEntryCode = serverEntryCode.replace(
  manifestKeyMarker,
  `${manifestKeyMarker}\n\tconst runtimeAppRoot = new URL("../../", import.meta.url);`,
);
const sessionConfigMarker = '\t\t...serializedManifest,';
if (!serverEntryCode.includes(sessionConfigMarker)) throw new Error('Astro standalone session config layout changed');
serverEntryCode = serverEntryCode.replace(
  sessionConfigMarker,
  `${sessionConfigMarker}\n\t\tsessionConfig: {\n\t\t\t...serializedManifest.sessionConfig,\n\t\t\toptions: { ...serializedManifest.sessionConfig.options, base: path.join(process.env.APPDATA || process.cwd(), "byqx-blog-desktop", "sessions") }\n\t\t},`,
);
writeFileSync(serverEntry, serverEntryCode, 'utf8');
console.log('✓ Astro 运行路径已改为相对便携包自身');

// ── 3) 复制桌面端资源（main.cjs 在 isPackaged 布局下从这里取模板与图标）──
const assets = path.join(OUT, 'resources', 'desktop-assets');
mkdirSync(assets, { recursive: true });
writeFileSync(path.join(assets, 'portable.marker'), 'portable\n', 'utf8');
for (const f of ['template.db', 'tray-icon.png']) {
  const from = path.join(ROOT, 'desktop', f === 'template.db' ? 'assets/template.db' : f);
  if (existsSync(from)) cpSync(from, path.join(assets, f));
}
console.log('✓ 模板库与托盘图标已复制（resources/desktop-assets）');

// ── 4) 复制运行期依赖闭包（保留依赖版本，真实文件）─────────────────────────
const nm = path.join(APP, 'node_modules');
mkdirSync(nm, { recursive: true });
const copied = new Set();
const packageSources = new Map();
let failed = 0;

const packagePath = (dir, name) => path.join(dir, ...name.split('/'));
function installedVersion(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

/** 判断当前包及祖先 node_modules 中是否已经有同一版本可供 Node 正常解析。 */
function hasAncestorDependency(parentDir, name, version) {
  let scope = parentDir;
  while (scope.startsWith(APP)) {
    const candidate = packagePath(path.join(scope, 'node_modules'), name);
    if (existsSync(candidate)) return installedVersion(candidate) === version;
    const next = path.dirname(scope);
    if (next === scope) break;
    scope = next;
  }
  return false;
}

/** 每个包按 pnpm 源依赖关系在最近的 node_modules 安装所需版本，避免同名包互相覆盖。 */
function installPackage(srcDir, destDir) {
  if (!existsSync(destDir)) {
    mkdirSync(path.dirname(destDir), { recursive: true });
    copyPackage(srcDir, destDir);
  }
  const targetKey = path.resolve(destDir);
  packageSources.set(targetKey, srcDir);
  if (copied.has(targetKey)) return;
  copied.add(targetKey);

  for (const dep of packageDeps(srcDir)) {
    const depSrc = resolvePackageDir(dep.name, srcDir);
    if (!depSrc) {
      if (!dep.optional) {
        console.error(`  ⚠ 无法解析依赖：${dep.name}（来自 ${path.basename(srcDir)}）`);
        failed += 1;
      }
      continue;
    }
    const version = installedVersion(depSrc);
    if (version && hasAncestorDependency(destDir, dep.name, version)) continue;
    const depDest = packagePath(path.join(destDir, 'node_modules'), dep.name);
    if (existsSync(depDest) && installedVersion(depDest) !== version) {
      console.error(`  ⚠ 包内依赖版本冲突：${dep.name}@${version}`);
      failed += 1;
      continue;
    }
    try {
      installPackage(depSrc, depDest);
    } catch (err) {
      console.error(`  ⚠ 复制 ${dep.name}@${version ?? '?'} 失败：${err && err.message ? err.message : err}`);
      failed += 1;
    }
  }
}

const builtinNames = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
for (const name of new Set(RUNTIME_ROOTS)) {
  if (builtinNames.has(name)) continue;
  const srcDir = resolvePackageDir(name, ROOT);
  if (!srcDir) {
    console.error(`  ⚠ 无法解析运行时依赖：${name}`);
    failed += 1;
    continue;
  }
  installPackage(srcDir, packagePath(nm, name));
}

// Windows + pnpm hard-linked package trees can occasionally yield zero-filled package.json
// files during recursive copies. Recheck installed package roots against their exact sources
// before shipping; repair the metadata file in place so Node's package resolver never sees it.
let repairedManifests = 0;
for (const [destDir, srcDir] of packageSources) {
  const sourceManifest = path.join(srcDir, 'package.json');
  const destManifest = path.join(destDir, 'package.json');
  if (!existsSync(sourceManifest) || !existsSync(destManifest)) continue;
  const sourceBytes = readFileSync(sourceManifest);
  const destBytes = readFileSync(destManifest);
  if (!sourceBytes.equals(destBytes)) {
    writeFileSync(destManifest, sourceBytes);
    repairedManifests += 1;
  }
}

if (failed) {
  throw new Error(`便携版有 ${failed} 个必需依赖未解析或复制失败，保留现有 release/portable`);
}
console.log(`✓ 依赖闭包已复制：${copied.size} 个包安装位置`);
if (repairedManifests) console.log(`✓ 已校验并修复 ${repairedManifests} 个包清单`);
console.log(`  依赖根清单（扫描产物得出）：${RUNTIME_ROOTS.join(', ')}`);

// ── 5) 体积与自检 ──────────────────────────────────────────────────────────
const sizeOf = (dir) => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem -Recurse -File '${dir}' | Measure-Object -Sum Length).Sum`], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) / 1024 / 1024);
  } catch {
    return -1;
  }
};
console.log(`\n临时产物：${OUT}`);
console.log(`  总大小约 ${sizeOf(OUT)} MB（其中 resources/app/node_modules 约 ${sizeOf(nm)} MB）`);
console.log(`  入口：${path.join(OUT, '白衣卿相.exe')}`);
// 所有内容先在暂存目录组装，完成后再替换固定便携目录；发布路径始终只有 release/portable。
// 若替换中断，会尽力把原目录恢复，避免留下半包。
mkdirSync(RELEASE, { recursive: true });
const previous = path.join(RELEASE, `.portable-previous-${process.pid}-${Date.now()}`);
let movedPrevious = false;
try {
  if (existsSync(PORTABLE)) {
    renameSync(PORTABLE, previous);
    movedPrevious = true;
  }
  renameSync(OUT, PORTABLE);
} catch (error) {
  if (movedPrevious && !existsSync(PORTABLE) && existsSync(previous)) renameSync(previous, PORTABLE);
  throw error;
}
if (movedPrevious) rmSync(previous, { recursive: true, force: true });
console.log(`\n已覆盖便携版目录：${PORTABLE}`);
console.log(`入口：${path.join(PORTABLE, '白衣卿相.exe')}`);
console.log('验证方式：从项目外部目录启动该 exe，确认不依赖源码。');
