import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { activeAiEditor } from '@/lib/ai-editor-bridge';
type Candidate = { url: string; token: string; baseline: string };
export default function ArticleCoverGenerator({ articleId }: { articleId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [candidate, setCandidate] = useState<Candidate>();
  const key = `ai-cover:${articleId}`;
  const onPage = () => button.current?.isConnected && document.getElementById('doc-detail-data')?.dataset.activeNode === articleId;
  useEffect(() => {
    mounted.current = true;
    try { const saved = sessionStorage.getItem(key); if (saved) { setCandidate(JSON.parse(saved)); setMessage('有一张保留的封面，确认后可应用。'); } } catch { /* Storage can be disabled. */ }
    return () => { mounted.current = false; };
  }, [key]);
  function retain(next: Candidate) {
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Still retain in the open panel. */ }
    if (mounted.current) setCandidate(next);
  }
  async function apply(next: Candidate, confirmed = false) {
    const editor = activeAiEditor();
    if (!onPage()) return;
    if (editor && (editor.domain !== 'article' || editor.targetId !== articleId || !await editor.flush())) throw Error('请先保存当前文章，再应用封面');
    if (!onPage() || (editor && activeAiEditor() !== editor)) throw Error('当前文章已切换，封面已保留');
    const response = await fetch('/api/ai/cover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: articleId, token: next.token, ...(confirmed ? { baseline: next.baseline } : {}) }) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 409 && result.token) retain(result); throw Error(result.error || '封面应用失败'); }
    try { sessionStorage.removeItem(key); } catch { /* No persistence. */ }
    window.dispatchEvent(new CustomEvent('article:cover-changed', { detail: { id: articleId, url: next.url } }));
    if (mounted.current) { setCandidate(undefined); setMessage('封面已生成并应用，可在文章设置或首页查看。'); }
  }
  async function generate() {
    setBusy(true); setMessage('正在保存文章、提炼主题并生成封面…'); dialog.current?.showModal();
    const editor = activeAiEditor();
    try {
      if (editor && (editor.domain !== 'article' || editor.targetId !== articleId || !await editor.flush())) throw Error('正文保存未完成，请重试');
      if (!onPage() || (editor && activeAiEditor() !== editor)) throw Error('当前文章已切换，请重新发起');
      const source = editor?.source();
      const response = await fetch('/api/ai/cover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: articleId }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '封面生成失败');
      retain(result);
      if (!mounted.current || !onPage()) return;
      if (editor && (activeAiEditor() !== editor || editor.source() !== source)) { setMessage('生成期间正文或编辑会话已变化。封面已保留，确认后再应用。'); return; }
      await apply(result);
    } catch (err) { if (mounted.current) setMessage((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <button ref={button} type="button" disabled={busy} onClick={() => candidate ? dialog.current?.showModal() : void generate()} className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-primary disabled:opacity-50">
      {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <ImagePlus size={14} />}{busy ? '生成封面中' : 'AI 生成封面'}
    </button>
    <dialog ref={dialog} onClose={() => button.current?.focus()} aria-labelledby={`cover-title-${articleId}`} className="w-[min(560px,calc(100vw-32px))] max-h-[85dvh] overflow-auto rounded-2xl border-2 border-foreground bg-background p-5 text-foreground shadow-[6px_6px_0_var(--color-primary)] backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3"><h2 id={`cover-title-${articleId}`} className="font-bold">文章封面</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="关闭封面窗口"><X size={18} /></button></div>
      <p className="mt-3 text-sm" role="status">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">文字摘要使用当前接入模式；图片服务在 AI 助手设置中单独选择，Cloudflare 免费额度用尽时需要等次日重置或按账户套餐计费。</p>
      {candidate && <><img src={candidate.url} alt="AI 生成的文章封面预览" className="mt-4 aspect-[3/2] w-full rounded-lg border border-border object-cover" />
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={async () => {
          setBusy(true); try { await apply(candidate, true); } catch (err) { setMessage((err as Error).message); } finally { if (mounted.current) setBusy(false); }
        }}>确认应用此封面</button><a href={candidate.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-3 py-2 text-sm">打开图片</a></div>
      </>}
      {!candidate && !busy && <button type="button" onClick={() => void generate()} className="mt-4 rounded-md border border-border px-3 py-2 text-sm">重新生成</button>}
    </dialog>
  </>;
}
