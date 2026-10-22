import { useEffect, useRef, useState } from 'react';
import { AppWindow, Code2, SquareTerminal, Globe, Plus, Search, Star, MoreHorizontal, Play, Square, RotateCw, FolderOpen, FileText, Pencil, Trash2, ArrowUp, ArrowDown, Upload, X, LoaderCircle, Sparkles, ExternalLink } from 'lucide-react';

type Kind = 'software' | 'source' | 'script' | 'web';
/** 脚本登记的两种来源：源文件（path）或直接粘贴的代码（code），互相排斥。 */
type ScriptMode = 'file' | 'inline';
type Entry = { id: string; kind: Kind; name: string; category: string; tags: string[]; favorite: boolean; path?: string; command?: string; arguments?: string; workingDirectory?: string; url?: string; icon?: string; status: string; error?: string; exitCode?: number | null; startedAt?: string; finishedAt?: string; invalid?: boolean; mode?: ScriptMode; code?: string };
type Preview = { path?: string; directory?: string; name: string; icon?: string; target?: string; arguments?: string; workingDirectory?: string; scripts?: Record<string, string>; engines?: Record<string, string>; locks?: string[]; dependencies?: string[]; readme?: string; packageManager?: string; hasDependencies?: boolean; node?: string; environment?: string; size?: number; lines?: number; modifiedAt?: string; mode?: ScriptMode; suggestion?: { command: string; url: string } };
type Form = { id?: string; kind: Kind; name: string; category: string; tags: string; favorite: boolean; path: string; command: string; arguments: string; workingDirectory: string; url: string; mode: ScriptMode; code: string };
type Bridge = { toolchain: (action: string, input?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>; pickToolchain: (kind: Kind) => Promise<{ ok: boolean; data?: Preview | null; error?: string }>; dropToolchainSoftware: (file: File) => Promise<{ ok: boolean; data?: Preview; error?: string }> };
const bridge = () => (window as unknown as { desktop?: Bridge }).desktop;
const empty = (kind: Kind = 'software'): Form => ({ kind, name: '', category: '', tags: '', favorite: false, path: '', command: '', arguments: '', workingDirectory: '', url: '', mode: 'file', code: '' });
const labels: Record<Kind, string> = { software: '本机软件', source: '源码项目', script: '脚本启动', web: '网页工具' };
const states: Record<string, string> = { ready: '可打开', stopped: '未启动', checking: '检查环境', starting: '启动中', running: '运行中', failed: '启动失败' };
const icons = { software: AppWindow, source: Code2, script: SquareTerminal, web: Globe };
const managed = (kind: Kind) => kind === 'source' || kind === 'script';
const running = (entry: Entry) => ['checking', 'starting', 'running'].includes(entry.status);
/** 运行时长文案：卡片每 2.5 秒轮询一次，直接用结束时间或当前时间计算，不额外起定时器。 */
const humanDuration = (from?: string, to?: string) => {
  const start = from ? Date.parse(from) : NaN, end = to ? Date.parse(to) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  return seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3600)} 时 ${Math.floor((seconds % 3600) / 60)} 分`;
};
async function invoke<T>(action: string, input?: unknown): Promise<T> {
  const api = bridge(); if (!api) throw Error('请在 Windows 桌面端打开工具链');
  const result = await api.toolchain(action, input);
  if (!result.ok) throw Error(result.error || '操作未完成');
  return result.data as T;
}

export default function Toolchain() {
  const [entries, setEntries] = useState<Entry[]>([]), [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState(''), [kind, setKind] = useState<Kind | 'all'>('all'), [category, setCategory] = useState(''), [favorites, setFavorites] = useState(false);
  const [form, setForm] = useState<Form | null>(null), [preview, setPreview] = useState<Preview | null>(null), [pending, setPending] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [warning, setWarning] = useState(''), [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState(''), [preparation, setPreparation] = useState(''), [analyzing, setAnalyzing] = useState(false), [logs, setLogs] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: Entry; x: number; y: number } | null>(null);
  const [attention, setAttention] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), logDialog = useRef<HTMLDialogElement>(null), abort = useRef<AbortController | null>(null), returnFocus = useRef<HTMLElement | null>(null);
  const incoming = useRef(false), seen = useRef<Map<string, string>>(new Map());
  const refresh = async () => { const list = await invoke<Entry[]>('list'); setEntries(list); setLoaded(true); };
  useEffect(() => {
    let mounted = true, polling = false;
    const poll = async () => { if (polling) return; polling = true; try { const list = await invoke<Entry[]>('list'); if (mounted) { for (const item of list) { const before = seen.current.get(item.id); seen.current.set(item.id, item.status); if (item.kind === 'script' && before && before !== item.status && item.status === 'failed') setAttention(item.id); } setEntries(list); setLoaded(true); } } catch (err) { if (mounted) setWarning((err as Error).message); } finally { polling = false; } };
    void poll(); const timer = setInterval(() => void poll(), 2500);
    return () => { mounted = false; clearInterval(timer); abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (form && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!form && dialog.current?.open) dialog.current.close();
  }, [Boolean(form)]);
  useEffect(() => { if (logs !== null && logDialog.current && !logDialog.current.open) logDialog.current.showModal(); if (logs === null && logDialog.current?.open) logDialog.current.close(); }, [logs !== null]);
  // 脚本异常退出时自动带出日志，省掉「先点菜单再看日志」；已有对话框打开时不打扰。
  useEffect(() => {
    if (!attention) return;
    const id = attention; setAttention(null);
    if (form || logs !== null) return;
    void (async () => { try { setLogs(await invoke<string>('logs', { id })); } catch (err) { setWarning((err as Error).message); } })();
  }, [attention, form, logs]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); returnFocus.current?.focus(); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [menu]);
  const closeForm = () => { abort.current?.abort(); setAnalyzing(false); setForm(null); setPreview(null); setPending([]); setAnalysis(''); setPreparation(''); setTimeout(() => returnFocus.current?.focus(), 0); };
  const openForm = (value: Form, details: Preview | null = null) => { returnFocus.current = document.activeElement as HTMLElement; setWarning(''); setAnalysis(''); setPreparation(''); setPreview(details); setForm(value); };
  const applyPreview = (details: Preview, type: Kind) => {
    setPreview(details);
    setForm(current => {
      const base = { ...(current || empty(type)), kind: type, name: details.name };
      if (type === 'script') return { ...base, path: details.path || '', workingDirectory: details.directory || '' };
      return { ...base, path: details.directory || details.path || '', command: details.suggestion?.command || '', url: details.suggestion?.url || '' };
    });
  };
  const pick = async () => {
    if (!form || form.kind === 'web') return;
    abort.current?.abort(); setAnalyzing(false);
    setBusy(true); setWarning('');
    try { const result = await bridge()?.pickToolchain(form.kind); if (!result?.ok) throw Error(result?.error || '请在桌面端操作'); if (result.data) applyPreview(result.data, form.kind); } catch (err) { setWarning((err as Error).message); } finally { setBusy(false); }
  };
  const inspect = async () => {
    if (!form) return; abort.current?.abort(); setAnalyzing(false); setBusy(true); setWarning('');
    try { const result = await invoke<Preview>(form.kind === 'source' ? 'inspect-project' : form.kind === 'script' ? 'inspect-script' : 'inspect-software', { path: form.path }); applyPreview(result, form.kind); } catch (err) { setWarning((err as Error).message); } finally { setBusy(false); }
  };
  const dropFiles = async (files: File[]) => {
    if (incoming.current || busy || form) { setWarning('请先完成或关闭当前登记'); return; }
    incoming.current = true; setBusy(true); setWarning('');
    try {
      if (files.length > 20) throw Error('一次最多拖入 20 个快捷方式或程序');
      const previews: Preview[] = [], errors: string[] = [];
      for (const file of files) {
        if (!/\.(lnk|exe)$/i.test(file.name)) { errors.push(`${file.name}：只支持 .lnk / .exe`); continue; }
        try { const result = await bridge()?.dropToolchainSoftware(file); if (!result?.ok || !result.data) throw Error(result?.error || '请在桌面端操作'); previews.push(result.data); } catch (err) { errors.push((err as Error).message); }
      }
      if (previews.length) { openForm({ ...empty(), path: previews[0]!.path || '', name: previews[0]!.name }, previews[0]!); setPending(previews.slice(1)); }
      if (errors.length) setWarning(errors.join('；'));
    } finally { incoming.current = false; setBusy(false); }
  };
  useEffect(() => {
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); } };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    const drop = (event: DragEvent) => { if (event.dataTransfer?.files.length) { event.preventDefault(); setDragging(false); void dropFiles(Array.from(event.dataTransfer.files)); } };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [busy, Boolean(form)]);
  const analyze = async (details = preview) => {
    if (!details?.scripts) return;
    setAnalyzing(true); setWarning(''); abort.current = new AbortController();
    try {
      const response = await fetch('/api/toolchain/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details), signal: abort.current.signal });
      const result = await response.json(); if (!response.ok) throw Error(result.error || '分析失败');
      setForm(current => current ? { ...current, command: result.command, url: result.url } : null); setAnalysis(result.explanation); setPreparation(result.preparation);
    } catch (err) { if ((err as Error).name !== 'AbortError') setWarning((err as Error).message); } finally { setAnalyzing(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return; setBusy(true); setWarning('');
    try {
      await invoke('save', form); await refresh(); setMessage(`已登记 ${form.name}，点击卡片即可打开`);
      if (pending.length) { const next = pending[0]!; setPending(pending.slice(1)); applyPreview(next, 'software'); } else closeForm();
    } catch (err) { setWarning((err as Error).message); } finally { setBusy(false); }
  };
  const operate = async (action: string, entry: Entry) => {
    setMenu(null); setWarning(''); setBusy(true);
    try {
      if (action === 'edit' || action === 'analyze') {
        if (action === 'analyze' && running(entry)) throw Error('请先停止项目，再重新分析启动配置');
        openForm({ ...empty(entry.kind), ...entry, mode: entry.mode === 'inline' ? 'inline' : 'file', code: entry.code || '', tags: entry.tags.join(', '), path: entry.path || '', command: entry.command || '', arguments: entry.arguments || '', workingDirectory: entry.workingDirectory || '', url: entry.url || '' });
        if (action === 'analyze') { const details = await invoke<Preview>('inspect-project', { path: entry.path }); setPreview(details); await analyze(details); }
        return;
      }
      if (action === 'copy-url') { await navigator.clipboard.writeText(entry.url || ''); setMessage('网页地址已复制'); return; }
      if (action === 'remove' && !window.confirm(`移除“${entry.name}”的入口？${entry.kind === 'source' ? '正在运行的服务会停止。' : ''}原文件与软件不会删除。`)) return;
      if (action === 'logs') { returnFocus.current = document.activeElement as HTMLElement; setLogs(await invoke<string>('logs', { id: entry.id })); return; }
      if (action === 'up' || action === 'down') { const ids = entries.map(item => item.id), group = entries.filter(item => item.kind === entry.kind).map(item => item.id), position = group.indexOf(entry.id), next = position + (action === 'up' ? -1 : 1); if (next < 0 || next >= group.length) return; const index = ids.indexOf(entry.id), target = ids.indexOf(group[next]!); [ids[index], ids[target]] = [ids[target]!, ids[index]!]; await invoke('reorder', { ids }); }
      else await invoke(action, { id: entry.id });
      await refresh(); if (action === 'launch') setMessage(entry.kind === 'source' ? '正在检查并启动，工具将在独立窗口打开' : entry.kind === 'script' ? '已在 PowerShell 中运行脚本，输出写入日志' : `已打开 ${entry.name}`);
    } catch (err) { setWarning((err as Error).message); } finally { setBusy(false); }
  };
  const context = (entry: Entry, x: number, y: number, element: HTMLElement) => { const rows = entry.kind === 'source' ? 10 : entry.kind === 'script' ? 9 : 6; const height = Math.min(window.innerHeight - 20, rows * (window.innerWidth <= 640 ? 44 : 36) + 12); returnFocus.current = element; setMenu({ entry, x: Math.max(8, Math.min(x, window.innerWidth - 228)), y: Math.max(8, Math.min(y, window.innerHeight - height - 8)) }); };
  const shown = entries.filter(entry => (kind === 'all' || kind === entry.kind) && (!category || entry.category === category) && (!favorites || entry.favorite) && `${entry.name} ${entry.category} ${entry.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const categories = [...new Set(entries.map(entry => entry.category).filter(Boolean))];
  const field = (name: keyof Form, value: string | boolean) => setForm(current => current ? { ...current, [name]: value } : null);
  /** 切换脚本来源时保留已填内容，避免来回切换丢失粘贴的代码。 */
  const switchScriptMode = (mode: ScriptMode) => { setWarning(''); setPreview(null); setAnalysis(''); setForm(current => current ? { ...current, mode } : null); };
  return <div className="tc-root">
    <div className="tc-intro"><div><b>{entries.length}</b> 个工具 <span>·</span> <b>{entries.filter(entry => entry.status === 'running').length}</b> 个项目运行中</div><button className="tc-primary" onClick={() => openForm(empty())}><Plus size={17} />添加工具</button></div>
    <div className="tc-filters"><label className="tc-search"><Search size={19} /><input type="search" aria-label="搜索工具" placeholder="搜索工具、分类或标签…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="分类" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(value => <option key={value}>{value}</option>)}</select><button aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Star size={16} fill={favorites ? 'currentColor' : 'none'} />收藏</button></div>
    <div className="tc-tabs">{(['all', 'software', 'source', 'script', 'web'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? '全部工具' : labels[value]}</button>)}</div>
    {warning && <p className="tc-warning" role="alert">{warning}</p>}<p className="tc-feedback" role="status" aria-live="polite">{message}</p>
    {dragging && <div className="tc-drop-overlay" aria-live="polite"><Upload size={40} /><b>松开鼠标，登记快捷方式或程序</b><span>先预览，再保存；不会立即启动</span></div>}
    {!loaded && !warning && <p className="tc-empty"><LoaderCircle className="tc-spin" size={24} />正在读取本机工具…</p>}
    {(['software', 'source', 'script', 'web'] as Kind[]).filter(type => kind === 'all' || kind === type).map(type => {
      const Icon = icons[type], group = shown.filter(entry => entry.kind === type);
      return <section className="tc-section" key={type}><header><h2><Icon size={23} />{labels[type]} <small>{group.length}</small></h2><button onClick={() => openForm(empty(type))}><Plus size={15} />添加</button></header>
        <p className="tc-section-help">{type === 'software' ? '把 .lnk 快捷方式或 .exe 拖到这里，也可以选择文件添加。' : type === 'source' ? '独立应用窗口，无浏览器标签。退出博客继续运行；关闭工具窗口停止其服务。' : type === 'script' ? '选择 .ps1 脚本，或直接粘贴脚本代码；点启动后在 PowerShell 中运行，输出写入日志，可随时停止。' : '点击后跳转外部浏览器，无需启动本地服务。'}</p>
        <div className="tc-cards">{group.map(entry => <article key={entry.id} className={`tc-card ${entry.status === 'running' ? 'is-running' : ''}`} aria-label={`${entry.name}，按回车打开，Shift+F10 显示菜单`} onClick={event => { if (!(event.target as HTMLElement).closest('button') && !busy && !entry.invalid) void operate('launch', entry); }} onContextMenu={event => { event.preventDefault(); context(entry, event.clientX, event.clientY, event.currentTarget); }} onKeyDown={event => { if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); context(entry, bounds.right - 220, bounds.top + 40, event.currentTarget); } else if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key) && !busy && !entry.invalid) { event.preventDefault(); void operate('launch', entry); } }} tabIndex={0}>
          <div className="tc-card-top"><span className="tc-tool-icon">{entry.icon ? <img src={entry.icon} alt="" width={36} height={36} /> : <Icon size={29} />}</span><div><h3 title={entry.name}>{entry.name}</h3><span className={`tc-state ${entry.status}`}>{entry.invalid ? '路径失效' : states[entry.status] || '未启动'}</span></div><button className="tc-icon-button" aria-label={`${entry.name}的更多操作`} aria-haspopup="menu" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); context(entry, bounds.left - 180, bounds.bottom + 6, event.currentTarget); }}><MoreHorizontal size={20} /></button></div>
          {type === 'script' && entry.mode === 'inline' ? <p className="tc-path" title="直接粘贴的脚本代码，保存在本机登记文件中">直接粘贴的脚本 · {(entry.code || '').split('\n').filter(line => line.trim()).length} 行</p> : <p className="tc-path" title={entry.path || entry.url}>{entry.path || entry.url}</p>}{entry.command && <code>{entry.command}</code>}{type === 'script' && <p className="tc-run-meta">{running(entry) ? `已运行 ${humanDuration(entry.startedAt) || '不到 1 秒'}` : entry.startedAt ? `上次${entry.status === 'failed' ? '失败' : '运行'} ${humanDuration(entry.startedAt, entry.finishedAt)}${entry.exitCode === null || entry.exitCode === undefined ? ' · 手动停止' : ` · 退出码 ${entry.exitCode}`}` : '尚未运行'}</p>}{entry.error && <p className="tc-card-error" title={entry.error}>{entry.error}</p>}
          <div className="tc-tags">{entry.category && <span>{entry.category}</span>}{entry.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
          <footer>{type === 'script' ? <button className="tc-launch" disabled={busy || entry.invalid} onClick={() => void operate(running(entry) ? 'stop' : 'launch', entry)}>{running(entry) ? <Square size={15} /> : <Play size={15} />}{running(entry) ? '停止脚本' : '启动脚本'}</button> : <button className="tc-launch" disabled={busy || entry.invalid} onClick={() => void operate('launch', entry)}>{type === 'web' ? <ExternalLink size={15} /> : <Play size={15} />}{entry.status === 'running' ? '打开窗口' : type === 'source' ? '启动项目' : '打开'}</button>}<button className="tc-icon-button" aria-label={`${entry.favorite ? '取消收藏' : '收藏'}${entry.name}`} aria-pressed={entry.favorite} disabled={busy} onClick={() => void operate('favorite', entry)}><Star size={18} fill={entry.favorite ? 'currentColor' : 'none'} /></button></footer>
        </article>)}</div>
        {!group.length && <div className="tc-empty"><img src="/images/neobrutalism/cat-peek.webp" width="65" height="52" alt="" aria-hidden="true" /><p>{entries.some(entry => entry.kind === type) ? '没有符合筛选的工具' : `还没有${labels[type]}，添加第一个吧。`}</p></div>}
      </section>;
    })}
    <p className="tc-bottom-note"><FolderOpen size={16} />登记信息仅保存在本机，不参与博客云同步。移除入口不会删除原项目。</p>
    {menu && <><div className="tc-menu-scrim" onClick={() => { setMenu(null); returnFocus.current?.focus(); }} /><div className="tc-menu" role="menu" aria-label={`${menu.entry.name}操作`} style={{ left: menu.x, top: menu.y }} onKeyDown={event => { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }} ref={element => { if (element && !element.contains(document.activeElement)) element.querySelector<HTMLButtonElement>('button')?.focus(); }}>
      <button role="menuitem" onClick={() => void operate('launch', menu.entry)}><Play size={16} />{menu.entry.kind === 'script' ? '启动脚本' : '打开'}</button>
      {managed(menu.entry.kind) && <><button role="menuitem" disabled={!running(menu.entry)} onClick={() => void operate('stop', menu.entry)}><Square size={16} />{menu.entry.kind === 'script' ? '停止脚本' : '停止服务'}</button><button role="menuitem" onClick={() => void operate('restart', menu.entry)}><RotateCw size={16} />{menu.entry.kind === 'script' ? '重新运行' : '重新启动'}</button><button role="menuitem" onClick={() => void operate('logs', menu.entry)}><FileText size={16} />查看日志</button></>}
      {(menu.entry.path || menu.entry.mode === 'inline') && <button role="menuitem" onClick={() => void operate('folder', menu.entry)}><FolderOpen size={16} />{menu.entry.kind === 'source' ? '打开当前项目文件夹' : menu.entry.mode === 'inline' ? '打开运行目录' : '打开所在文件夹'}</button>}
      {menu.entry.kind === 'source' && <button role="menuitem" onClick={() => void operate('analyze', menu.entry)}><Sparkles size={16} />重新分析启动方式</button>}
      {menu.entry.kind === 'web' && <button role="menuitem" onClick={() => void operate('copy-url', menu.entry)}><FileText size={16} />复制网页地址</button>}
      <button role="menuitem" onClick={() => void operate('edit', menu.entry)}><Pencil size={16} />编辑登记信息</button><button role="menuitem" onClick={() => void operate('up', menu.entry)}><ArrowUp size={16} />向前移动</button><button role="menuitem" onClick={() => void operate('down', menu.entry)}><ArrowDown size={16} />向后移动</button><button role="menuitem" className="tc-danger" onClick={() => void operate('remove', menu.entry)}><Trash2 size={16} />移除入口</button>
    </div></>}
    <dialog className="tc-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) closeForm(); }} aria-labelledby="tc-form-title">
      {form && <form onSubmit={save}><header><div><p className="tc-eyebrow">ADD TOOL / 本机登记</p><h2 id="tc-form-title">{form.id ? '编辑工具' : '添加工具'}</h2></div><button type="button" aria-label="关闭登记" disabled={busy} onClick={closeForm}><X size={21} /></button></header>
        {!form.id && <div className="tc-tabs">{(['software', 'source', 'script', 'web'] as Kind[]).map(type => <button type="button" key={type} disabled={busy || analyzing} aria-pressed={form.kind === type} onClick={() => { setForm(empty(type)); setPreview(null); setPending([]); setAnalysis(''); setPreparation(''); }}>{labels[type]}</button>)}</div>}
        {form.kind === 'script' && <div className="tc-tabs tc-source-tabs" role="group" aria-label="脚本来源">{([['file', '使用 .ps1 脚本文件'], ['inline', '直接粘贴脚本代码']] as [ScriptMode, string][]).map(([value, text]) => <button type="button" key={value} disabled={busy || analyzing} aria-pressed={form.mode === value} onClick={() => switchScriptMode(value)}>{text}</button>)}</div>}
        {form.kind !== 'web' && !(form.kind === 'script' && form.mode === 'inline') && <><button type="button" className="tc-picker" disabled={busy} onClick={() => void pick()}><Upload size={23} /><b>{form.kind === 'source' ? '选择项目文件夹' : form.kind === 'script' ? '选择 .ps1 PowerShell 脚本' : '选择 .lnk 快捷方式或 .exe'}</b><span>{form.kind === 'source' ? '读取启动说明与脚本，不修改项目文件' : form.kind === 'script' ? '在 PowerShell 中运行；不会修改脚本文件' : '也可以先关闭本窗口，从资源管理器拖入'}</span></button><label>{form.kind === 'source' ? '文件夹位置' : form.kind === 'script' ? '脚本位置' : '文件位置'}<input required value={form.path} onChange={event => { field('path', event.target.value); setPreview(null); setAnalysis(''); }} placeholder="选择或填写本机路径" /></label><button type="button" disabled={busy || !form.path} onClick={() => void inspect()}>{form.kind === 'source' ? '重新读取项目' : form.kind === 'script' ? '重新读取脚本' : '读取软件信息'}</button></>}
        <div className="tc-form-grid"><label>名称<input required maxLength={80} value={form.name} onChange={event => field('name', event.target.value)} /></label><label>分类<input maxLength={30} value={form.category} onChange={event => field('category', event.target.value)} placeholder="例如：写作 / 开发 / 设计" list="tc-category-options" /></label></div><datalist id="tc-category-options">{categories.map(value => <option key={value} value={value} />)}</datalist>
        <label>标签<input value={form.tags} onChange={event => field('tags', event.target.value)} placeholder="多个标签用逗号分隔" /></label>
        {form.kind === 'software' && preview && <div className="tc-preview"><b>{preview.icon && <img src={preview.icon} alt="" width={28} height={28} />}{preview.name}</b><p>目标：{preview.target}</p>{preview.arguments && <p>原启动参数：{preview.arguments}</p>}{preview.workingDirectory && <p>原工作目录：{preview.workingDirectory}</p>}<small>直接打开原文件，保留快捷方式的启动方式。</small></div>}
        {form.kind === 'script' && <>{form.mode === 'inline' && <label>脚本代码<textarea required value={form.code} onChange={event => field('code', event.target.value)} spellCheck={false} autoComplete="off" rows={12} aria-describedby="tc-code-help" placeholder={'# 直接粘贴 PowerShell 代码，例如\nWrite-Output "你好"'} /><small id="tc-code-help">{form.code.trim() ? `${form.code.replace(/\r\n?/g, '\n').trim().split('\n').length} 行 · ${Math.max(1, Math.round(new TextEncoder().encode(form.code).length / 1024))} KB` : '支持中文与多行；按原样保存，每次启动都使用这里的最新代码'} · 以 UTF-8 保存为 .ps1 后用 PowerShell 运行</small></label>}{preview?.path && <div className="tc-preview"><b>{preview.name}</b><p>脚本：{preview.path}</p><p>大小：{Math.max(1, Math.round((preview.size || 0) / 1024))} KB{preview.modifiedAt ? ` · 修改于 ${new Date(preview.modifiedAt).toLocaleString()}` : ''}</p><small>启动时用 PowerShell 运行该脚本；运行参数与工作目录均可留空。</small></div>}<label>启动参数（可选）<input value={form.arguments} onChange={event => field('arguments', event.target.value)} placeholder="例如 -Verbose -Env test" maxLength={500} /><small>按空格分词，含空格的参数用引号包裹；不支持管道、重定向与命令串联。</small></label><label>工作目录（可选）<input value={form.workingDirectory} onChange={event => field('workingDirectory', event.target.value)} placeholder={form.mode === 'inline' ? '默认为用户主目录' : '默认为脚本所在目录'} /><small>{form.mode === 'inline' ? '留空时以用户主目录为工作目录；脚本要写相对路径请先指定目录。' : '留空时以脚本所在目录为工作目录。'}</small></label><div className="tc-lifecycle"><SquareTerminal size={19} /><span>后台运行 · 无独立窗口<br />退出博客继续运行；在卡片按钮或菜单里停止脚本。</span></div></>}
        {form.kind === 'source' && <><div className="tc-environment"><b>环境检测</b><p>{preview?.environment || '选择目录后可检测环境与启动脚本'}</p>{preview?.scripts && <p>可用脚本：{Object.keys(preview.scripts).join(' / ') || '无'}</p>}{preview && !preview.hasDependencies && <p>尚未发现 node_modules，请在原项目中手动准备依赖。</p>}{preview?.engines && Object.keys(preview.engines).length > 0 && <p>项目要求：{JSON.stringify(preview.engines)}</p>}</div><button type="button" className="tc-primary" disabled={busy || analyzing || !preview?.scripts} onClick={() => void analyze()}>{analyzing ? <LoaderCircle className="tc-spin" size={17} /> : <Sparkles size={17} />}{analyzing ? 'AI 正在分析…' : '让博客 AI 分析启动方式'}</button>{analyzing && <button type="button" onClick={() => abort.current?.abort()}>取消分析</button>}<p className="tc-help">仅发送启动脚本、依赖名称和 README 摘要。不会读取 .env；建议须核对后保存。</p><label>启动命令<input required value={form.command} onChange={event => field('command', event.target.value)} placeholder="npm run dev" /></label><label>工具本机地址<input required type="url" value={form.url} onChange={event => field('url', event.target.value)} placeholder="http://127.0.0.1:5173" /></label><p className="tc-help">命令与地址的端口须一致，服务须监听本机地址。复杂启动步骤请写入项目脚本，不支持命令串联。</p>{analysis && <div className="tc-preview"><b>启动依据 · 请核对</b><p>{analysis}</p><p>{preparation}</p></div>}<div className="tc-lifecycle"><AppWindow size={19} /><span>独立应用窗口 · 无标签栏<br />退出博客继续运行；关闭该工具窗口停止服务。</span></div></>}
        {form.kind === 'web' && <label>网页地址<input required type="url" value={form.url} onChange={event => field('url', event.target.value)} placeholder="https://…" /><small>在系统默认浏览器打开，仅接受 HTTP / HTTPS。</small></label>}
        <label className="tc-checkbox"><input type="checkbox" checked={form.favorite} onChange={event => field('favorite', event.target.checked)} />加入收藏</label>
        {warning && <p className="tc-warning" role="alert">{warning}</p>}
        <footer><span>{pending.length ? `保存后继续登记余下 ${pending.length} 个文件` : '只登记入口，保存后不会自动启动'}</span><button type="button" disabled={busy} onClick={closeForm}>取消</button><button className="tc-primary" disabled={busy || analyzing} type="submit">{busy ? '处理中…' : '保存工具'}</button></footer>
      </form>}
    </dialog>
    <dialog className="tc-dialog tc-log-dialog" ref={logDialog} onCancel={() => { setLogs(null); setTimeout(() => returnFocus.current?.focus(), 0); }} aria-labelledby="tc-log-title"><header><h2 id="tc-log-title">工具启动日志</h2><button aria-label="关闭日志" onClick={() => { setLogs(null); setTimeout(() => returnFocus.current?.focus(), 0); }}><X size={20} /></button></header><pre>{logs}</pre><p className="tc-help">显示最近的日志。项目自身输出可能包含敏感信息，请勿公开分享。</p></dialog>
  </div>;
}
