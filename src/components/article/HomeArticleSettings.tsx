import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ArticleCategory } from '@/lib/article-categories';

export interface HomeSettingsArticle {
  id: string;
  title: string;
  type: 'tech' | 'note' | 'photo';
  summary: string;
  cover: string;
  tags: string[];
  encrypted: boolean;
  encryptHint: string;
}

interface Props {
  article: HomeSettingsArticle;
  categories: ArticleCategory[];
  categoryId: string | null;
}

function categoryLabel(category: ArticleCategory, byId: Map<string, ArticleCategory>): string {
  const path = [category.name];
  const seen = new Set([category.id]);
  let cursor = category.parentId;
  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor);
    if (!parent) break;
    path.unshift(parent.name);
    seen.add(cursor);
    cursor = parent.parentId;
  }
  return path.join(' / ');
}

export default function HomeArticleSettings({ article, categories, categoryId }: Props): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState(article);
  const [summary, setSummary] = useState(article.summary);
  const [cover, setCover] = useState(article.cover);
  const [type, setType] = useState(article.type);
  const [tags, setTags] = useState(article.tags.join(', '));
  const [encrypted, setEncrypted] = useState(article.encrypted);
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState(article.encryptHint);
  const [folder, setFolder] = useState(categoryId ?? '');
  const [savedFolder, setSavedFolder] = useState(categoryId ?? '');
  const [availableCategories, setAvailableCategories] = useState(categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = new Map(availableCategories.map((category) => [category.id, category]));

  useEffect(() => {
    const button = document.getElementById('home-article-settings');
    const open = (): void => {
      dialogRef.current?.showModal();
      void fetch('/api/article-categories').then((res) => res.ok ? res.json() : null).then((data) => {
        if (Array.isArray(data?.categories)) setAvailableCategories(data.categories as ArticleCategory[]);
      }).catch(() => { /* 保留初始目录列表 */ });
    };
    button?.addEventListener('click', open);
    return () => {
      button?.removeEventListener('click', open);
    };
  }, []);

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (document.getElementById('doc-3col')?.dataset.editing === 'true') {
      setError('请先保存并退出正文编辑，再保存文章设置');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(current.id)}/metadata`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          summary, cover, type,
          tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
          encrypted, encryptPassword: password || undefined, encryptHint: hint,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.article) throw new Error(data.error ?? '设置保存失败');
      if (folder !== savedFolder) {
        const moved = await fetch('/api/article-categories', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ articleId: current.id, categoryId: folder || null }),
        });
        if (!moved.ok) throw new Error('文章已保存，但目录移动失败，请重试');
      }
      setCurrent((prev) => ({ ...prev, summary, cover, type, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), encrypted, encryptHint: hint }));
      const folderChanged = folder !== savedFolder;
      setSavedFolder(folder);
      setPassword('');
      dialogRef.current?.close();
      if (folderChanged) window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="m-auto w-[min(92vw,40rem)] rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <form onSubmit={(event) => void save(event)} className="max-h-[85vh] overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">文章设置</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭文章设置" className="rounded px-2 text-xl text-muted-foreground hover:text-foreground">×</button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">所属目录<select value={folder} onChange={(event) => setFolder(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">未分类</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category, byId)}</option>)}</select></label>
        <label className="text-sm">文章类型<select value={type} onChange={(event) => setType(event.target.value as HomeSettingsArticle['type'])} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="tech">技术</option><option value="note">随笔</option><option value="photo">摄影</option></select></label>
        <label className="text-sm sm:col-span-2">标签（用逗号分隔）<input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
        <label className="text-sm sm:col-span-2">摘要<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
        <label className="text-sm sm:col-span-2">封面地址<input value={cover} onChange={(event) => setCover(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
      </div>
      <div className="mt-5 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={encrypted} onChange={(event) => setEncrypted(event.target.checked)} />启用访问密码</label>
        {encrypted && <div className="mt-3 grid gap-3"><label className="text-sm">{current.encrypted ? '更换密码（留空保留原密码）' : '访问密码'}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label><label className="text-sm">密码提示<input value={hint} onChange={(event) => setHint(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label></div>}
      </div>
      <div className="mt-4 flex items-center gap-3 text-sm"><a href="/admin/mindmaps" className="text-primary hover:underline">管理思维导图</a></div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md border border-border px-4 py-2 text-sm">取消</button><button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">保存设置</button></div>
    </form>
  </dialog>;
}
