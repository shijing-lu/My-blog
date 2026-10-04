import { discardArticleField, flushPendingArticleSaves, pendingArticleField, rememberArticleSave, saveArticleSnapshot } from './pending-article-saves';
/** 文档与首页文章共用的标题原位编辑。标题独立 PATCH，避免与正文自动保存互相覆盖。 */
export interface InlineArticleTitleSession {
  flush(): Promise<boolean>;
  close(discard?: boolean): void;
}

const AUTOSAVE_MS = 650;

export function activateInlineArticleTitle(id: string, onError: (message: string) => void): InlineArticleTitleSession {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return { flush: async () => true, close: () => {} };
  const home = document.querySelector('[data-article-domain="home"]') !== null;
  const url = home ? `/api/articles/${encodeURIComponent(id)}/title` : `/api/doc/nodes/${encodeURIComponent(id)}`;
  const data = document.getElementById('doc-detail-data');
  let saved = home ? (data?.dataset.rawTitle ?? heading.textContent ?? '') : (heading.textContent ?? '');
  let timer = 0;
  let pending: Promise<void> | null = null;
  let closed = false;

  if (home && !saved) heading.textContent = '';
  const pendingTitle = pendingArticleField(url, 'title');
  if (pendingTitle !== null) heading.textContent = pendingTitle;
  heading.dataset.inlineTitleEditing = 'true';
  heading.dataset.inlineTitlePlaceholder = '未命名文章';
  heading.contentEditable = 'plaintext-only';
  heading.setAttribute('role', 'textbox');
  heading.setAttribute('aria-label', '文章标题，修改后自动保存');
  heading.setAttribute('aria-multiline', 'false');
  heading.spellcheck = false;

  const value = (): string => (heading.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const flush = async (): Promise<boolean> => {
    window.clearTimeout(timer);
    while (!closed) {
      if (pending) {
        try { await pending; } catch { return false; }
        continue;
      }
      const title = value();
      if (title === saved) return true;
      if (!title) { onError('标题不能为空'); return false; }
      pending = (async () => {
        await saveArticleSnapshot(url, { title });
        saved = title;
        if (data && home) data.dataset.rawTitle = title;
        if (closed && heading.isConnected) heading.textContent = title;
        document.dispatchEvent(new CustomEvent('article-title-saved', { detail: { id, title } }));
      })();
      try { await pending; }
      catch (error) { onError(error instanceof Error ? error.message : '标题保存失败'); return false; }
      finally { pending = null; }
    }
    return true;
  };
  const schedule = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void flush(); }, AUTOSAVE_MS);
  };
  const onInput = (): void => {
    if ((heading.textContent ?? '').length > 200) {
      heading.textContent = value();
      const range = document.createRange();
      range.selectNodeContents(heading);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
    if (value()) rememberArticleSave(url, { title: value() });
    schedule();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') { event.preventDefault(); heading.blur(); }
    if (event.key === 'Escape') {
      event.preventDefault();
      window.clearTimeout(timer);
      heading.textContent = saved;
      discardArticleField(url, 'title');
      heading.blur();
    }
  };
  const onBlur = (): void => { void flush(); };
  const onPageHide = (): void => {
    if (value() === saved && !pending) return;
    void flush();
    void flushPendingArticleSaves(true);
  };
  heading.addEventListener('input', onInput);
  heading.addEventListener('keydown', onKeydown);
  heading.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  if (pendingTitle !== null) schedule();

  return {
    flush,
    close(discard = false): void {
      window.clearTimeout(timer);
      if (discard) discardArticleField(url, 'title');
      closed = true;
      heading.removeEventListener('input', onInput);
      heading.removeEventListener('keydown', onKeydown);
      heading.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      heading.removeAttribute('contenteditable');
      heading.removeAttribute('role');
      heading.removeAttribute('aria-multiline');
      heading.removeAttribute('aria-label');
      delete heading.dataset.inlineTitleEditing;
      delete heading.dataset.inlineTitlePlaceholder;
      heading.textContent = saved || '未命名文章';
    },
  };
}
