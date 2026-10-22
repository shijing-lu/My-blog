import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { renderMdx } from '@/lib/mdx';

describe('Debug Chapter 5 renderMdx', () => {
  it('tests renderMdx on data/blog.db', async () => {
    const db = new Database('data/blog.db');
    const row = db.prepare('SELECT content FROM doc_nodes WHERE id = ?').get('cb2e93a5-9ca2-4f17-aacc-1f3c193413e7') as { content: string };
    try {
      const res = await renderMdx(row.content);
      console.log('blog.db renderMdx SUCCESS! HTML len:', res.html.length);
    } catch (err: any) {
      console.error('blog.db renderMdx FAILED:', err.message, err.place || '', err.stack);
      throw err;
    }
  });

  it('tests renderMdx on blog-local.db', async () => {
    const db = new Database(process.env.APPDATA + '/byqx-blog-desktop/blog-local.db');
    const row = db.prepare('SELECT content FROM doc_nodes WHERE id = ?').get('cb2e93a5-9ca2-4f17-aacc-1f3c193413e7') as { content: string };
    try {
      const res = await renderMdx(row.content);
      console.log('blog-local.db renderMdx SUCCESS! HTML len:', res.html.length);
    } catch (err: any) {
      console.error('blog-local.db renderMdx FAILED:', err.message, err.place || '', err.stack);
      throw err;
    }
  });
});
