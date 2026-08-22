/** 检查文章当前全文：是否含测试文本/转义反引号 */
import Database from 'better-sqlite3';
const db = new Database('data/blog.db', { readonly: true });
const row = db.prepare("SELECT content FROM articles WHERE slug='markdown-editor-shortcuts'").get();
const c = row.content;
console.log('字符数', c.length);
console.log('含「测试一下」?', c.includes('测试一下'));
console.log('含 反斜杠+反引号?', c.includes('\\`'));
const bs = (c.match(/\\/g) ?? []).length;
console.log('反斜杠总数', bs);
console.log('--- 前 160 字符（JSON） ---');
console.log(JSON.stringify(c.slice(0, 160)));
