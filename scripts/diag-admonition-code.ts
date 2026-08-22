/** 渲染整篇存入原文，检查 admonition 块内 inlineCode 输出 */
import Database from 'better-sqlite3';
import { renderMdx } from '../src/lib/mdx';

const db = new Database('data/blog.db', { readonly: true });
const row = db.prepare("SELECT content FROM articles WHERE slug='markdown-editor-shortcuts'").get();
const { html } = await renderMdx(row.content);

console.log('=== admonition 提示块 HTML ===');
const i = html.indexOf('提示');
if (i >= 0) {
  console.log(html.slice(i, i + 320));
} else {
  console.log('未找到「提示」（可能 admonition 渲染异常），打印前 400：');
  console.log(html.slice(0, 400));
}
