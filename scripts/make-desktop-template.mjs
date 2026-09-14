/**
 * 生成桌面端「空库模板」（package.json `desktop:template`）
 *
 * 桌面端首次启动需要一份**结构完整、内容为空**的本地 SQLite 库：
 * 由 `drizzle-kit push`（SQLite 方言）把 `db/schema.sqlite.ts` 推到临时库，
 * 校验表数量后拷贝为 `desktop/assets/template.db`，随安装包分发
 * （electron-builder `extraResources` → Electron 主进程首启复制到 %APPDATA%）。
 *
 * ⚠️ schema 变更后必须重跑 `pnpm desktop:template`（已纳入 `dist:desktop` 链条）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP_DIR = path.join(ROOT, '.diag', 'desktop-template');
const TMP_DB = path.join(TMP_DIR, 'template.db');
const OUT = path.join(ROOT, 'desktop', 'assets', 'template.db');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

/** 生成临时 drizzle 配置（与 drizzle.config.sqlite.ts 同构，仅 url 指向临时库） */
const cfgSrc = fs.readFileSync(path.join(ROOT, 'drizzle.config.sqlite.ts'), 'utf8');
const cfgTmp = cfgSrc.replace(
  /url:\s*'[^']*'/,
  `url: ${JSON.stringify(`file:${TMP_DB.split(path.sep).join('/')}`)}`,
);
fs.writeFileSync(path.join(TMP_DIR, 'drizzle.config.tmp.ts'), cfgTmp, 'utf8');

// drizzle-kit 需要解析 TS 配置与 schema（含 @ 别名）→ 直接用 node 调其 bin（绕开 pnpm 的
// run 前置校验，见 scripts/build-desktop.mjs 同款做法）
const drizzleKitBin = path.join(ROOT, 'node_modules', 'drizzle-kit', 'bin.cjs');
const res = spawnSync(
  process.execPath,
  [
    drizzleKitBin, 'push',
    `--config=${path.join(TMP_DIR, 'drizzle.config.tmp.ts')}`,
    '--force',
  ],
  { cwd: ROOT, stdio: 'inherit', shell: false },
);
if (res.status !== 0) {
  console.error('[desktop-template] drizzle-kit push 失败');
  process.exit(1);
}

// 校验：表数量必须与 schema 声明一致（当前 30 张）
const requireHere = createRequire(import.meta.url);
const Database = requireHere('better-sqlite3');
const db = new Database(TMP_DB, { readonly: true });
const count = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_KV' AND name NOT LIKE 'drizzle%'`).get().c;
db.close();
if (count < 25) {
  console.error(`[desktop-template] 模板库表数量异常：${count}（预期 ≥25）`);
  process.exit(1);
}

fs.copyFileSync(TMP_DB, OUT);
console.log(`[desktop-template] 模板库已生成：${OUT}（${count} 张表，${Math.round(fs.statSync(OUT).size / 1024)}KB）`);
