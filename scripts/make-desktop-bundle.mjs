/**
 * 组装「自包含」桌面端目录（不依赖源码 / 不依赖 pnpm 软链）
 *
 * 产物：release/standalone/
 *   ├─ 白衣卿相.exe            ← Electron 运行时（从 node_modules/electron/dist 复制）
 *   ├─ *.dll / *.pak / locales/
 *   └─ resources/
 *       ├─ app/                ← 应用载荷（编译产物 + 壳 + 依赖闭包）
 *       │   ├─ dist/           Astro 产物（client + server）
 *       │   ├─ desktop/        main.cjs / preload.cjs / assets/template.db
 *       │   ├─ package.json    main 字段指向 desktop/main.cjs
 *       │   └─ node_modules/   运行期依赖（扁平化，真实文件）
 *       └─ desktop-assets/     模板库与托盘图标（main.cjs 在 isPackaged 布局下读这里）
 *
 * 为什么需要：便携版若用目录联接指向源码，删掉源码就启动失败。
 * 本脚本把所需一切复制进来，产物可整体拷到任何目录（甚至别的机器）运行。
 *
 * 用法：node scripts/make-desktop-bundle.mjs
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
/**
 * 输出到**带版本号的新目录**（而非覆盖固定目录）
 *
 * 为什么：固定目录需要先删除/改名旧产物，实测在 Windows 上常被占用（EPERM），
 * 而且沙箱会拦截批量删除。版本化输出既无锁冲突，又天然保留历史版本可供回滚。
 */
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
let OUT = path.join(ROOT, 'release', `standalone-${VERSION}`);
if (existsSync(OUT)) OUT = `${OUT}-${Date.now().toString().slice(-6)}`;
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
    const code = readFileSync(full, 'utf8');
    const specs = [
      ...code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g),
      ...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
      ...code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ];
    for (const m of specs) {
      const spec = m[1];
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') ||
          spec.startsWith('astro:') || spec.startsWith('data:') || spec.startsWith('file:') ||
          spec.startsWith('http')) continue;
      const parts = spec.split('/');
      const name = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      if (name) out.add(name);
    }
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
 * 这里：跳过包内嵌套 node_modules（依赖已扁平化到顶层）、悬空软链直接跳过。
 */
function copyPackage(src, dest, depth = 0) {
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
function resolvePackageDir(name, fromDir) {
  try {
    const entry = requireHere.resolve(`${name}/package.json`, { paths: [fromDir] });
    return path.dirname(entry);
  } catch {
    // 有些包不导出 package.json：解析主入口再向上找 package.json。
    // 必须校验 name 匹配——否则会被包内的标记文件截获（postgres 的
    // cjs/package.json 仅 {"type":"commonjs"}，曾被误判为包根导致产物损坏）。
    try {
      let dir = path.dirname(requireHere.resolve(name, { paths: [fromDir] }));
      for (let i = 0; i < 8; i += 1) {
        const pkgJson = path.join(dir, 'package.json');
        if (existsSync(pkgJson)) {
          try {
            if (JSON.parse(readFileSync(pkgJson, 'utf8')).name === name) return dir;
          } catch {
            /* 非法 JSON：继续向上 */
          }
        }
        dir = path.dirname(dir);
      }
    } catch {
      /* 解析失败 */
    }
    return null;
  }
}

/** 读包的 dependencies（含 optionalDependencies 里的平台包，如 sharp 的 @img/*） */
function packageDeps(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})];
  } catch {
    return [];
  }
}

// ── 1) 复制 Electron 运行时到版本化目录 ────────────────────────────────────
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

// ── 3) 复制桌面端资源（main.cjs 在 isPackaged 布局下从这里取模板与图标）──
const assets = path.join(OUT, 'resources', 'desktop-assets');
mkdirSync(assets, { recursive: true });
for (const f of ['template.db', 'tray-icon.png']) {
  const from = path.join(ROOT, 'desktop', f === 'template.db' ? 'assets/template.db' : f);
  if (existsSync(from)) cpSync(from, path.join(assets, f));
}
console.log('✓ 模板库与托盘图标已复制（resources/desktop-assets）');

// ── 4) 复制运行期依赖闭包（扁平化，真实文件）───────────────────────────────
const nm = path.join(APP, 'node_modules');
mkdirSync(nm, { recursive: true });
const copied = new Set();
const queue = RUNTIME_ROOTS.map((name) => ({ name, fromDir: ROOT }));
let failed = 0;

while (queue.length > 0) {
  const { name, fromDir } = queue.pop();
  if (copied.has(name)) continue;
  const srcDir = resolvePackageDir(name, fromDir);
  if (!srcDir) {
    console.error(`  ⚠ 无法解析依赖：${name}（跳过）`);
    failed += 1;
    continue;
  }
  const destDir = path.join(nm, name);
  if (!existsSync(destDir)) {
    mkdirSync(path.dirname(destDir), { recursive: true });
    try {
      copyPackage(srcDir, destDir);
    } catch (err) {
      console.error(`  ⚠ 复制 ${name} 失败：${err && err.message ? err.message : err}`);
      failed += 1;
      continue;
    }
  }
  copied.add(name);
  for (const dep of packageDeps(srcDir)) queue.push({ name: dep, fromDir: srcDir });
}
console.log(`✓ 依赖闭包已复制：${copied.size} 个包${failed ? `（${failed} 个失败）` : ''}`);
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
console.log(`\n产物：${OUT}`);
console.log(`  总大小约 ${sizeOf(OUT)} MB（其中 resources/app/node_modules 约 ${sizeOf(nm)} MB）`);
console.log(`  入口：${path.join(OUT, '白衣卿相.exe')}`);
console.log('\n验证方式（从项目外部目录启动，确保不依赖源码）：');
console.log(`  1) 把整个 ${OUT} 复制到任意目录（如桌面）`);
console.log('  2) 双击其中的 白衣卿相.exe');
