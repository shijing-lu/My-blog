import { eq } from 'drizzle-orm';
import { articles, articlePostCategories } from '../../db/schema.sqlite';
import { dbWrite } from '../../db';
import { MarkdownImportError } from './markdown-file-import';

/** Insert once, with the category in the same transaction. Never upsert author edits. */
export async function importArticleFile(file: { id: string; title: string; content: string }, categoryId: string | null): Promise<void> {
  const now = new Date();
  const values = { ...file, slug: `article-${file.id}`, type: 'tech', summary: '', cover: '', tags: '[]', published: false,
    encrypted: false, encryptHint: '', encryptMeta: '', createdAt: now, updatedAt: now };
  const match = (row: typeof articles.$inferSelect, category: string | null): void => {
    if (!row || row.title !== file.title || row.content !== file.content || category !== categoryId) throw new MarkdownImportError('导入标识对应的文章已变化，请重新拖入文件', 409);
  };
  await dbWrite(async (database, postgres) => {
    // Match the project's dialect-specific transaction handling: SQLite is synchronous.
    if (postgres) {
      await (database as any).transaction(async (tx: any) => {
        const inserted = await tx.insert(articles).values(values).onConflictDoNothing({ target: articles.id }).returning();
        if (!inserted.length) {
          const [row] = await tx.select().from(articles).where(eq(articles.id, file.id));
          const [link] = await tx.select().from(articlePostCategories).where(eq(articlePostCategories.articleId, file.id));
          match(row, link?.categoryId ?? null);
        } else if (categoryId) await tx.insert(articlePostCategories).values({ articleId: file.id, categoryId, createdAt: now });
      });
    } else {
      (database as any).transaction((tx: any) => {
        const inserted = tx.insert(articles).values(values).onConflictDoNothing({ target: articles.id }).returning().all();
        if (!inserted.length) {
          const row = tx.select().from(articles).where(eq(articles.id, file.id)).get();
          const link = tx.select().from(articlePostCategories).where(eq(articlePostCategories.articleId, file.id)).get();
          match(row, link?.categoryId ?? null);
        } else if (categoryId) tx.insert(articlePostCategories).values({ articleId: file.id, categoryId, createdAt: now }).run();
      });
    }
  });
}
