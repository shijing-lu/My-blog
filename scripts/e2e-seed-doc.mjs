/**
 * e2e-seed-doc.mjs —— 本地 E2E：在本地 SQLite 播种一个临时文档（册 + 文章节点）
 *
 * 用法：
 *   node scripts/e2e-seed-doc.mjs          # 先备份 data/blog.db，再插入种子数据
 *   node scripts/e2e-seed-doc.mjs --clean  # 删除种子数据并输出清理结果
 *
 * 种子内容覆盖 WYSIWYG 全部渲染目标（标题/粗斜/代码/公式/列表/任务/引用/链接）。
 * 数据安全：仅动本地 SQLite（生产在 PG）；写前备份到 data/blog.db.bak-e2e-*；
 * E2E 结束用 --clean 删除（也可用备份恢复）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';

const DB_PATH = 'data/blog.db';
const CATEGORY_ID = 'e2e-cat-0000-0000-0000-000000000000';
const BUNDLE_ID = 'e2e-bundle-0000-0000-0000-000000000000';
const NODE_ID = 'e2e-node-0000-0000-0000-000000000000';

/** 覆盖全部渲染目标的种子正文 */
const CONTENT = [
  '# 一级标题 E2E',
  '',
  '段落带 **粗体**、*斜体*、`行内代码` 与 [示例链接](https://example.com)。',
  '',
  '## 二级标题 公式验证',
  '',
  '行内公式 $x^2 + y^2 = z^2$ 与行内分数 $\\frac{a}{b}$。',
  '',
  '块级公式（含积分限，截图曾糊）：',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '分式嵌套与上下标：',
  '',
  '$$',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1, \\quad \\frac{\\frac{a}{b}}{\\frac{c}{d}} = \\frac{ad}{bc}',
  '$$',
  '',
  '## 三级标题 · 列表区',
  '',
  '- 无序列表一项',
  '- 无序列表二项',
  '  - 嵌套列表',
  '',
  '1. 有序列表一',
  '2. 有序列表二',
  '',
  '- [ ] 未完成任务项',
  '- [x] 已完成任务项',
  '',
  '> 这是一段引用文本',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  '![示例图占位](https://example.com/a.png)',
].join('\n');

function nowMs() {
  return Date.now();
}
function sha1(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

/** 备份数据库（幂等：同秒多次运行去重） */
function backup() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const path = `${DB_PATH}.bak-e2e-${stamp}-${sha1(CONTENT)}`;
  if (!existsSync(path)) {
    copyFileSync(DB_PATH, path);
  }
  console.log(`[seed] 已备份数据库 → ${path}`);
  return path;
}

function seed() {
  if (!existsSync(DB_PATH)) throw new Error(`找不到本地库 ${DB_PATH}`);
  backup();
  const db = new Database(DB_PATH);
  const has = db.prepare('SELECT COUNT(*) c FROM doc_nodes WHERE id=?').get(NODE_ID).c;
  if (has > 0) {
    console.log('[seed] 种子节点已存在，跳过插入（如需重置先 --clean）');
    db.close();
    return;
  }
  const t = nowMs();
  db.prepare(
    `INSERT OR REPLACE INTO doc_categories (id, name, sort, created_at) VALUES (?, ?, ?, ?)`,
  ).run(CATEGORY_ID, 'E2E 临时分类', 999, t);
  db.prepare(
    `INSERT OR REPLACE INTO doc_bundles (id, category_id, name, icon, summary, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(BUNDLE_ID, CATEGORY_ID, 'E2E 临时文档', '🧪', 'WYSIWYG 端到端验证用，测完即删', 999, t);
  db.prepare(
    `INSERT OR REPLACE INTO doc_nodes (id, bundle_id, parent_id, kind, title, content, sort, created_at, updated_at)
     VALUES (?, ?, NULL, 'article', ?, ?, 0, ?, ?)`,
  ).run(NODE_ID, BUNDLE_ID, 'E2E WYSIWYG 验收文章', CONTENT, t, t);
  db.close();
  console.log(`[seed] 已插入：category=${CATEGORY_ID}`);
  console.log(`[seed]            bundle=${BUNDLE_ID}`);
  console.log(`[seed]            node=${NODE_ID}`);
  console.log(`[seed] URL: http://localhost:PORT/doc/${BUNDLE_ID}#${NODE_ID}`);
}

function clean() {
  const db = new Database(DB_PATH);
  const delNode = db.prepare('DELETE FROM doc_nodes WHERE id=?').run(NODE_ID).changes;
  const delBundle = db.prepare('DELETE FROM doc_bundles WHERE id=?').run(BUNDLE_ID).changes;
  const delCat = db.prepare('DELETE FROM doc_categories WHERE id=?').run(CATEGORY_ID).changes;
  db.close();
  console.log(`[clean] 已删除：node=${delNode} bundle=${delBundle} category=${delCat}`);
}

const isClean = process.argv.includes('--clean');
if (isClean) clean();
else seed();
