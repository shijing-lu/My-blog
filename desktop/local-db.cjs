const { existsSync, mkdirSync, copyFileSync, renameSync } = require('node:fs');
const path = require('node:path');

/**
 * 本地库健康检查（PRAGMA quick_check）
 *
 * 为什么需要：SQLite 库与它的 `-wal` / `-shm` 是一体的。实测踩坑——
 * 单独替换 `blog-local.db` 而留下旧 `-wal` 会导致
 * `database disk image is malformed`，页面全部 500，用户看到的是"应用坏了"。
 */
function isLocalDbHealthy(localDbPath, logLaunch) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(localDbPath, { readonly: true });
    const row = db.prepare('PRAGMA quick_check').get();
    db.close();
    const ok = row && Object.values(row)[0] === 'ok';
    if (!ok) logLaunch(`本地库 quick_check 异常：${JSON.stringify(row)}`);
    return !!ok;
  } catch (err) {
    logLaunch(`本地库不可用（${err && err.message ? err.message : err}）：将备份并重建`);
    return false;
  }
}

/** 把本地库及其 -wal / -shm 一起移走（SQLite 三者必须同进同出） */
function quarantineLocalDb(localDbPath, logLaunch) {
  const stamp = Date.now();
  for (const suffix of ['', '-wal', '-shm']) {
    const from = localDbPath + suffix;
    if (!existsSync(from)) continue;
    try {
      renameSync(from, `${localDbPath}.bad-${stamp}${suffix}`);
    } catch (err) {
      logLaunch(`移走 ${path.basename(from)} 失败：${err && err.message ? err.message : err}`);
    }
  }
}

/**
 * 确保本地库可用：缺失 → 用模板创建；损坏 → 备份重建
 *
 * 重建后的库是空的，用户下次同步会重新拉全量（本地优先架构下这是可接受的恢复路径）。
 */
function ensureLocalDb(localDbPath, tpl, logLaunch = () => {}) {
  mkdirSync(path.dirname(localDbPath), { recursive: true });

  if (existsSync(localDbPath) && isLocalDbHealthy(localDbPath, logLaunch)) {
    ensureQuickNotesTable(localDbPath);
    return;
  }

  if (existsSync(localDbPath)) {
    quarantineLocalDb(localDbPath, logLaunch); // 损坏：留档后重建，绝不让应用变砖
    logLaunch('本地库已隔离重建（原文件保留为 .bad-<时间戳>）');
  }
  if (tpl) copyFileSync(tpl, localDbPath);
  else logLaunch('未找到模板库，本地库将由服务端首次迁移创建');
  if (existsSync(localDbPath)) ensureQuickNotesTable(localDbPath);
}

/** 旧版桌面本地库启动时补表；新模板已含此表，IF NOT EXISTS 保持幂等。 */
function ensureQuickNotesTable(localDbPath) {
  const Database = require('better-sqlite3');
  const localDb = new Database(localDbPath);
  try {
    localDb.exec(`CREATE TABLE IF NOT EXISTS quick_notes (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL DEFAULT '',
      content text NOT NULL DEFAULT '',
      tags text NOT NULL DEFAULT '[]',
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`);
  } finally {
    localDb.close();
  }
}

module.exports = { ensureLocalDb };
