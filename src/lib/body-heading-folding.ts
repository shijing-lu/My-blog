/** Display-only heading sections. The original MDX nodes and heading ids stay intact. */
const HEADING = /^H([1-6])$/;
const SECTION = '[data-body-heading-section]';
const BODY = '[data-body-heading-content]';
const sessionStates = new Map<string, Map<string, boolean>>();
let nextBodyId = 0;

function articleKey(article: HTMLElement): string {
  const explicit = article.dataset.headingFoldKey;
  if (explicit) return explicit;
  const domain = article.closest<HTMLElement>('[data-article-domain]')?.dataset.articleDomain ?? 'article';
  const id = document.getElementById('doc-detail-data')?.dataset.activeNode ?? location.pathname;
  return `${domain}:${id}`;
}

function stateFor(key: string): Map<string, boolean> {
  let state = sessionStates.get(key);
  if (!state) {
    if (sessionStates.size >= 64) sessionStates.delete(sessionStates.keys().next().value!);
    state = new Map();
    sessionStates.set(key, state);
  }
  return state;
}

function setExpanded(section: HTMLElement, expanded: boolean): void {
  const button = section.firstElementChild?.querySelector<HTMLButtonElement>(':scope > .body-heading-toggle');
  const body = section.lastElementChild as HTMLElement | null;
  if (!button || !body?.matches(BODY)) return;
  body.hidden = !expanded;
  button.setAttribute('aria-expanded', String(expanded));
  const label = `${expanded ? '折叠' : '展开'}${section.dataset.headingLabel ?? '章节'}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  stateFor(section.dataset.articleKey!).set(section.dataset.bodyHeadingSection!, expanded);
}

export function enhanceBodyHeadings(article: HTMLElement): void {
  // Wrappers from an earlier enhancement are left alone; a new innerHTML has none.
  if (article.querySelector(SECTION)) return;
  const key = articleKey(article);
  const state = stateFor(key);
  const keys = new WeakMap<Element, string>();
  const occurrences = new Map<string, number>();
  const containers = new Set<HTMLElement>();
  const sections: HTMLElement[] = [];
  // Compute identities before inserting wrappers, in the original document order.
  article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading) => {
    if (heading.closest('pre,code,table,summary,script,style,.not-prose') || !heading.parentElement) return;
    const base = `${heading.tagName}:${heading.id || heading.textContent?.trim() || ''}`;
    const nth = occurrences.get(base) ?? 0;
    occurrences.set(base, nth + 1);
    keys.set(heading, `${base}:${nth}`);
    containers.add(heading.parentElement);
  });
  const enhanceContainer = (container: HTMLElement): void => {
    const children = [...container.childNodes];
    const stack: { level: number; body: HTMLElement; section: HTMLElement }[] = [];
    for (const child of children) {
      const match = child instanceof HTMLElement ? HEADING.exec(child.tagName) : null;
      if (match && child instanceof HTMLElement && keys.has(child)) {
        const level = Number(match[1]);
        while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
        const section = document.createElement('div');
        section.dataset.bodyHeadingSection = keys.get(child)!;
        section.dataset.articleKey = key;
        section.dataset.headingLabel = `${level}级标题：${child.textContent?.trim() || '无标题'}`;
        const body = document.createElement('div');
        body.dataset.bodyHeadingContent = '';
        body.id = `body-heading-content-${++nextBodyId}`;
        if (stack.length) stack[stack.length - 1]!.body.appendChild(section);
        else container.insertBefore(section, child);
        section.append(child, body);
        sections.push(section);
        stack.push({ level, body, section });
      } else if (stack.length) {
        stack[stack.length - 1]!.body.appendChild(child);
      }
    }
  };
  // Only visit heading parents, not the hundreds of thousands of KaTeX descendants.
  containers.forEach(enhanceContainer);
  for (const section of sections) {
    const heading = section.firstElementChild as HTMLElement;
    const body = section.lastElementChild as HTMLElement;
    if ((!body.textContent?.trim() && !body.querySelector('img,video,audio,iframe,svg,canvas,hr,input'))) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'body-heading-toggle';
    button.setAttribute('aria-controls', body.id);
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    heading.classList.add('body-heading-foldable');
    heading.prepend(button);
    button.addEventListener('click', () => setExpanded(section, button.getAttribute('aria-expanded') !== 'true'));
    setExpanded(section, state.get(section.dataset.bodyHeadingSection!) ?? true);
  }
}

/** Reveal all containing chapters, including the target chapter itself for heading links. */
export function revealBodyHeading(target: Element): void {
  let section = target.closest<HTMLElement>(SECTION);
  while (section) {
    setExpanded(section, true);
    section = section.parentElement?.closest<HTMLElement>(SECTION) ?? null;
  }
}

export function initializeBodyHeadingFolding(): void {
  document.querySelectorAll<HTMLElement>('article[data-heading-folding]').forEach(enhanceBodyHeadings);
}
