/**
 * scripts/bench-mdx.ts —— MDX 渲染管线基准（临时诊断用）
 *
 * 目的：量化「大文章切换慢」到底慢在哪一环。
 * 测量：源码 → HTML 的体积膨胀、DOM 标签数、KaTeX 节点数、首次渲染耗时、缓存命中耗时。
 *
 * 用法：pnpm exec tsx scripts/bench-mdx.ts
 */
import Database from 'better-sqlite3';
import { renderMdx } from '../src/lib/mdx';

const db = new Database('data/blog.db', { readonly: true });

async function bench(label: string, src: string): Promise<void> {
  const t0 = performance.now();
  const out = await renderMdx(src);
  const t1 = performance.now();
  const htmlLen = out.html.length;
  const tags = (out.html.match(/</g) ?? []).length;
  const katex = (out.html.match(/class="katex"/g) ?? []).length;
  const spans = (out.html.match(/<span/g) ?? []).length;
  const t2 = performance.now();
  await renderMdx(src); // 第二次：LRU 缓存命中
  const t3 = performance.now();
  console.log(
    `${label.padEnd(20)} 源 ${String(src.length).padStart(7)} → HTML ${String(htmlLen).padStart(8)} (${(htmlLen / src.length).toFixed(1)}x)` +
      ` | 标签 ${String(tags).padStart(6)} | span ${String(spans).padStart(6)} | KaTeX ${String(katex).padStart(4)}` +
      ` | 首渲 ${(t1 - t0).toFixed(0)}ms | 缓存 ${(t3 - t2).toFixed(1)}ms`,
  );
}

const rows = db.prepare('SELECT title, content FROM articles ORDER BY length(content) DESC').all() as Array<{
  title: string;
  content: string;
}>;

console.log('=== 真实文章 ===');
for (const r of rows) await bench(r.title.slice(0, 18), r.content);

console.log('\n=== 合成大文章（重复真实内容，观察伸缩性） ===');
const base = rows[0]?.content ?? '';
for (const mult of [2, 5, 10, 20]) {
  await bench(`x${mult} (${Math.round((base.length * mult) / 1024)}KB)`, base.repeat(mult));
}

db.close();
