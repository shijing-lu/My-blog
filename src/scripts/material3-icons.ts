/** Adapt legacy app control SVGs without replacing controls or authored SVG content. */
export {};
const lucideIcons: Record<string, string> = {
  home: 'home', house: 'home', file: 'description', 'file-text': 'description', files: 'description',
  image: 'image', images: 'photo_library', 'image-plus': 'upload', camera: 'photo_library',
  'message-circle': 'chat', 'message-square': 'chat', 'more-horizontal': 'more_horiz', 'ellipsis': 'more_horiz',
  calendar: 'calendar_month', 'calendar-days': 'calendar_month', pencil: 'edit', 'square-pen': 'edit',
  plus: 'add', search: 'search', settings: 'settings', 'settings-2': 'tune', 'sliders-horizontal': 'tune',
  user: 'person', 'user-round': 'person', 'log-out': 'logout', menu: 'menu', x: 'close',
  'arrow-left': 'arrow_back', 'arrow-right': 'arrow_forward', 'chevron-down': 'expand_more',
  'chevron-up': 'expand_less', 'chevron-right': 'chevron_right', check: 'check', 'circle-check': 'check_circle',
  'circle-alert': 'error', info: 'info', 'triangle-alert': 'warning', cloud: 'cloud_sync',
  upload: 'upload', download: 'download', trash: 'delete', 'trash-2': 'delete', copy: 'content_copy',
  bold: 'format_bold', italic: 'format_italic', list: 'format_list_bulleted', 'list-ordered': 'format_list_numbered',
  link: 'link', 'link-2': 'link', table: 'table_chart', 'table-2': 'table_chart', code: 'code',
  'code-2': 'code', undo: 'undo', 'undo-2': 'undo', redo: 'redo', 'redo-2': 'redo',
  maximize: 'fullscreen', 'maximize-2': 'fullscreen', folder: 'folder', 'folder-open': 'folder',
  'git-branch': 'account_tree', network: 'account_tree', globe: 'public', moon: 'dark_mode', sun: 'light_mode',
  bell: 'notifications', save: 'save', eye: 'visibility', history: 'history', printer: 'print',
  'external-link': 'open_in_new', 'refresh-cw': 'refresh', sparkles: 'auto_awesome',
  'sticky-note': 'sticky_note_2', timer: 'timer', 'layout-dashboard': 'dashboard',
};
const labels: Array<[RegExp, string]> = [
  [/关闭|取消|close/i, 'close'], [/后退|返回|back/i, 'arrow_back'], [/前进|forward/i, 'arrow_forward'],
  [/主题|外观|风格/, 'tune'], [/个人中心|账户|头像/, 'person'], [/搜索|search/i, 'search'],
  [/复制|copy/i, 'content_copy'], [/上传|upload/i, 'upload'], [/下载|download/i, 'download'],
  [/删除|移除|trash|delete/i, 'delete'], [/同步|sync/i, 'cloud_sync'], [/设置|settings/i, 'settings'],
  [/折叠|收起/, 'expand_less'], [/展开/, 'expand_more'], [/编辑|edit/i, 'edit'],
  [/新建|添加|新增|add/i, 'add'], [/保存|save/i, 'save'], [/粗体|bold/i, 'format_bold'],
  [/斜体|italic/i, 'format_italic'], [/撤销|undo/i, 'undo'], [/重做|redo/i, 'redo'],
  [/链接|link/i, 'link'], [/图片|image/i, 'image'], [/表格|table/i, 'table_chart'],
  [/代码|code/i, 'code'], [/打印|print/i, 'print'], [/全屏|fullscreen/i, 'fullscreen'],
  [/AI|助手/, 'auto_awesome'], [/笔记|随心录/, 'sticky_note_2'], [/首页/, 'home'],
  [/回到顶部/, 'expand_less'], [/退出|logout/i, 'logout'],
];

function adapt(root: ParentNode): void {
  const candidates = root.querySelectorAll<SVGElement>('button svg, a svg, summary svg, [role="button"] svg');
  for (const svg of candidates) {
    if (svg.closest('.material-icon-pair') || svg.closest('[data-material-icon-adapted]')) continue;
    const control = svg.closest<HTMLElement>('button, a, summary, [role="button"]');
    if (!control || control.closest('.tk-avatar, .mindmap-canvas') || svg.closest('symbol')) continue;
    const label = control.getAttribute('aria-label') || control.getAttribute('title') || '';
    if (control.closest('.prose') && !control.matches('button') && !label) continue;
    let name = control.matches('.body-heading-toggle, .cm-heading-fold-button, .toc-fold') ? 'chevron_right' : control.id === 'theme-toggle' || /切换亮暗/.test(label)
      ? (document.documentElement.classList.contains('dark') ? 'light_mode' : 'dark_mode')
      : '';
    if (!name) {
      const lucide = [...svg.classList].find(value => value.startsWith('lucide-'))?.slice(7);
      name = lucide ? lucideIcons[lucide] || '' : '';
    }
    if (!name) name = labels.find(([pattern]) => pattern.test(label))?.[1] || '';
    if (!name) continue;
    // Only direct control icons: never hide an authored diagram or a descendant widget.
    if (svg.parentElement !== control) continue;
    // Only icon-only app controls receive an icon role; authored inline tools keep their geometry.
    if (control.matches('button') && !control.dataset.m3Role && !control.textContent?.trim() && !control.closest('.prose, .cm-content, .cm-gutters, .mindmap-canvas') && !control.matches('.body-heading-toggle, .cm-heading-fold-button, .toc-fold, .copy-button, .collapse-toggle, .md-table-edge-button')) control.dataset.m3Role = 'icon-button';
    const glyph = document.createElement('span');
    glyph.className = 'material-symbol';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = name;
    if (/切换亮暗/.test(label)) glyph.dataset.materialModeIcon = '';
    control.dataset.materialIconAdapted = '';
    control.appendChild(glyph);
  }
}

let installed = false;
function init(): void {
  adapt(document);
  if (installed) return;
  installed = true;
  const pending = new Set<Element>();
  let frame = 0;
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element && !node.classList.contains('material-symbol')) pending.add(node);
    }
    if (pending.size && !frame) frame = requestAnimationFrame(() => {
      frame = 0;
      for (const node of pending) if (node.isConnected) adapt(node);
      pending.clear();
    });
  });
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('byqx:theme-change', () => {
    document.querySelectorAll<HTMLElement>('[data-material-mode-icon]').forEach(glyph => {
      glyph.textContent = document.documentElement.classList.contains('dark') ? 'light_mode' : 'dark_mode';
    });
  });
}
init();
document.addEventListener('astro:page-load', init);
