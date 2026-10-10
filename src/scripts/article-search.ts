import type { SiteSearchHit } from '@/lib/site-search';

function initialize() {
  const dialog = document.getElementById('article-global-search') as HTMLDialogElement | null;
  const bar = document.getElementById('article-find');
  if (!dialog || !bar || dialog.dataset.bound) return;
  dialog.dataset.bound = '1';
  const lifetime = new AbortController(), signal = lifetime.signal;
  const siteQuery = document.getElementById('article-site-query') as HTMLInputElement;
  const findQuery = document.getElementById('article-find-query') as HTMLInputElement;
  const status = document.getElementById('article-site-status')!;
  const results = document.getElementById('article-site-results')!;
  const count = document.getElementById('article-find-count')!;
  const prev = document.getElementById('article-site-prev') as HTMLButtonElement;
  const next = document.getElementById('article-site-next') as HTMLButtonElement;
  let returnFocus: HTMLElement | null = null, globalReturnFocus: HTMLElement | null = null;
  let request: AbortController | null = null, requestId = 0, timer = 0, findTimer = 0, page = 1;
  let ranges: Range[] = [], current = -1;
  let textIndex: { node: Text; from: number; to: number }[] = [], fullText = '';
  const restored = new Map<HTMLElement, { hidden: boolean; expanded: string | null }>();
  const revealed = new Set<HTMLElement>();
  const marks: HTMLElement[] = [];

  function restoreHidden() {
    for (const [body, state] of restored) {
      body.hidden = state.hidden;
      const button = body.parentElement?.querySelector('.body-heading-toggle');
      if (button && state.expanded !== null) button.setAttribute('aria-expanded', state.expanded);
    }
    restored.clear();
    revealed.forEach(item => item.classList.remove('article-find-reveal')); revealed.clear();
  }
  function clearHighlights() {
    if ('highlights' in CSS) { CSS.highlights.delete('article-find'); CSS.highlights.delete('article-find-current'); }
    for (const mark of marks) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent?.normalize(); }
    marks.length = 0;
  }
  function closeFind(focus = true) {
    clearTimeout(findTimer); clearHighlights(); restoreHidden(); bar!.hidden = true;
    ranges = []; textIndex = []; fullText = '';
    if (focus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function indexText() {
    clearHighlights(); textIndex = []; fullText = '';
    const article = document.querySelector('main article.prose, article.prose');
    if (!article) return;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const parent = node.parentElement;
      if (!node.textContent || !parent || parent.closest('script,style,.katex-mathml,.spoiler-toggle-wrap,.body-heading-toggle,.not-prose')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('button') && !parent.closest('.spoiler')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    let node: Node | null;
    while ((node = walker.nextNode())) { const from = fullText.length; fullText += node.textContent; textIndex.push({ node: node as Text, from, to: fullText.length }); }
  }
  function locate(delta = 0) {
    restoreHidden();
    if (!ranges.length) { count.textContent = '0 个匹配'; return; }
    current = (current + delta + ranges.length) % ranges.length;
    const range = ranges[current]!;
    let element = range.startContainer.parentElement;
    while (element) {
      if (element.matches('[data-body-heading-content]') && element.hidden) {
        const button = element.parentElement?.querySelector('.body-heading-toggle');
        restored.set(element, { hidden: true, expanded: button?.getAttribute('aria-expanded') ?? null });
        element.hidden = false; button?.setAttribute('aria-expanded', 'true');
      }
      if (element.matches('.spoiler')) { element.classList.add('article-find-reveal'); revealed.add(element); }
      element = element.parentElement;
    }
    count.textContent = `${current + 1} / ${ranges.length}`;
    if ('highlights' in CSS) CSS.highlights.set('article-find-current', new Highlight(range));
    const rect = range.getBoundingClientRect();
    if (rect.height) window.scrollBy({ top: rect.top - Math.max(140, innerHeight / 3), behavior: 'instant' as ScrollBehavior });
  }
  function find() {
    restoreHidden();
    if (marks.length) indexText(); else clearHighlights();
    const q = findQuery.value.trim().toLowerCase();
    ranges = []; current = 0;
    if (q) {
      const text = fullText.toLowerCase(); let offset = 0;
      while ((offset = text.indexOf(q, offset)) !== -1) {
        const at = (pos: number) => {
          let left = 0, right = textIndex.length;
          while (left < right) { const mid = (left + right) >>> 1; if (textIndex[mid]!.to <= pos) left = mid + 1; else right = mid; }
          return textIndex[left];
        };
        const start = at(offset), end = at(offset + q.length - 1);
        if (start && end) { const range = document.createRange(); range.setStart(start.node, offset - start.from); range.setEnd(end.node, offset + q.length - end.from); ranges.push(range); }
        offset += q.length;
      }
    }
    if ('highlights' in CSS) { const highlight = new Highlight(); ranges.forEach(range => highlight.add(range)); CSS.highlights.set('article-find', highlight); }
    else {
      // Only split text nodes in the reading DOM. Never replace article HTML or editor state.
      for (const range of [...ranges].reverse()) if (range.startContainer === range.endContainer) {
        const mark = document.createElement('mark'); mark.className = 'article-find-mark'; range.surroundContents(mark); marks.push(mark);
      }
    }
    locate();
  }
  function openFind() {
    if (dialog!.open) dialog!.close();
    if (document.getElementById('doc-3col')?.dataset.editing === 'true' && window.__docInlineEditor?.openSearch?.()) { closeFind(false); return; }
    if (bar!.hidden) { returnFocus = document.activeElement as HTMLElement; bar!.hidden = false; indexText(); }
    findQuery.focus({ preventScroll: true }); findQuery.select(); find();
  }
  async function search() {
    clearTimeout(timer); request?.abort(); const id = ++requestId;
    const ctrl = new AbortController(); request = ctrl;
    results.replaceChildren(); status.textContent = '搜索中…'; prev.disabled = next.disabled = true;
    try {
      const response = await fetch(`/api/search?scope=site&q=${encodeURIComponent(siteQuery.value.trim())}&page=${page}&pageSize=20`, { signal: AbortSignal.any([signal, ctrl.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || '搜索失败');
      if (id !== requestId || signal.aborted) return;
      for (const hit of data.articles as SiteSearchHit[]) {
        if (!hit.url.startsWith('/') || hit.url.startsWith('//')) continue;
        const link = document.createElement('a'); link.href = hit.url; link.className = 'block rounded-lg border border-border p-3 hover:bg-accent';
        const title = document.createElement('strong'), location = document.createElement('p'), snippet = document.createElement('p');
        title.textContent = hit.title || '未命名'; location.textContent = `${hit.source === 'doc' ? '文档' : '文章'} · ${hit.location}${hit.encrypted ? ' · 加密' : ''}`;
        location.className = 'mt-1 text-xs text-muted-foreground'; snippet.className = 'mt-2 break-words text-sm'; snippet.textContent = hit.snippet;
        link.append(title, location, snippet); link.addEventListener('click', () => dialog!.close(), { signal }); results.append(link);
      }
      status.textContent = data.total ? `共 ${data.total} 个结果` : '没有匹配结果';
      prev.disabled = page === 1; next.disabled = page * 20 >= data.total;
      document.getElementById('article-site-page')!.textContent = `${page} / ${Math.max(1, Math.ceil(data.total / 20))}`;
    } catch (error) { if (id === requestId && !ctrl.signal.aborted && !signal.aborted) status.textContent = error instanceof Error ? error.message : '搜索失败，请重试'; }
  }
  function openGlobal() {
    globalReturnFocus = document.activeElement as HTMLElement;
    closeFind(false); if (!dialog!.open) dialog!.showModal(); siteQuery.focus(); siteQuery.select(); void search();
  }
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      if (document.querySelector('dialog[open]:not(#article-global-search)')) return;
      event.preventDefault(); event.stopPropagation(); event.shiftKey ? openGlobal() : openFind();
    } else if (event.key === 'Escape' && dialog!.open) { event.preventDefault(); event.stopPropagation(); dialog!.close(); }
    else if (event.key === 'Escape' && !bar!.hidden) { event.preventDefault(); closeFind(); }
  }, { capture: true, signal });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const entry = target?.closest<HTMLElement>('[data-article-search]');
    if (entry) entry.dataset.articleSearch === 'site' ? openGlobal() : openFind();
    // Manual chapter toggles during a search remain the user's explicit preference.
    const fold = target?.closest('.body-heading-toggle');
    if (fold) { const body = fold.closest('[data-body-heading-section]')?.querySelector<HTMLElement>(':scope > [data-body-heading-content]'); if (body) restored.delete(body); }
  }, { signal });
  findQuery.addEventListener('input', () => { clearTimeout(findTimer); findTimer = window.setTimeout(find, 120); }, { signal });
  findQuery.addEventListener('keydown', event => { if (!event.isComposing && event.key === 'Enter') { event.preventDefault(); clearTimeout(findTimer); locate(event.shiftKey ? -1 : 1); } }, { signal });
  bar.querySelector('[data-find-prev]')?.addEventListener('click', () => locate(-1), { signal });
  bar.querySelector('[data-find-next]')?.addEventListener('click', () => locate(1), { signal });
  bar.querySelector('[data-find-close]')?.addEventListener('click', () => closeFind(), { signal });
  siteQuery.addEventListener('input', () => { request?.abort(); ++requestId; page = 1; clearTimeout(timer); timer = window.setTimeout(() => void search(), 200); }, { signal });
  prev.addEventListener('click', () => { page--; void search(); }, { signal }); next.addEventListener('click', () => { page++; void search(); }, { signal });
  dialog.querySelector('[data-search-close]')?.addEventListener('click', () => dialog!.close(), { signal });
  dialog.addEventListener('close', () => { request?.abort(); clearTimeout(timer); if (globalReturnFocus?.isConnected) globalReturnFocus.focus({ preventScroll: true }); }, { signal });
  document.addEventListener('spoiler:refresh', () => { if (!bar!.hidden) { restoreHidden(); indexText(); find(); } }, { signal });
  document.addEventListener('astro:before-swap', () => { closeFind(false); request?.abort(); clearTimeout(timer); lifetime.abort(); }, { once: true, signal });
}
initialize(); document.addEventListener('astro:page-load', initialize);
