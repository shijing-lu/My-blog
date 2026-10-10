import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/archive-workspace');
const databasePath = path.join(out, 'empty.db');
const source = new Database(path.join(out, 'test.db'), { readonly: true });
try { await source.backup(databasePath); } finally { source.close(); }
const empty = new Database(databasePath);
try { empty.pragma('foreign_keys = OFF'); empty.prepare('DELETE FROM articles').run(); } finally { empty.close(); }
const log = fs.openSync(path.join(out, 'empty-server.log'), 'w');
const base = 'http://127.0.0.1:43229';
const server = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], { cwd: out, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: '43229', DATABASE_URL: 'file:' + databasePath,
    DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '', DESKTOP_MODE: '1',
    BYQX_CONFIG_PATH: path.join(out, 'empty-config.json'), ADMIN_PASSWORD: 'article-review-local', AUTH_SECRET: 'archive-empty-isolated-test',
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '', R2_PUBLIC_BASE_URL: '' }, stdio: ['ignore', log, log] });
let browser;
const report = [];
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/archive')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(base + '/archive');
    assert.equal(await page.locator('[data-archive-item]').count(), 0);
    await page.getByRole('heading', { name: '文字还在酝酿中' }).waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, `archive-empty-${width}.png`) });
    report.push({ width, empty: true, overflow: false });
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  fs.closeSync(log); fs.writeFileSync(path.join(out, 'empty-report.json'), JSON.stringify(report, null, 2));
}
console.log(`ARCHIVE_EMPTY_OK ${report.length}`);
