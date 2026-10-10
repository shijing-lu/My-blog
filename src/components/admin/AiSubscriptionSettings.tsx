import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn, LogOut, X } from 'lucide-react';

type Provider = { id: string; name: string; connected: boolean; models: { id: string; name: string }[]; error?: string };
type Login = {
  id: string; provider: string; status: string; error?: string;
  event?: { type: string; url?: string; verificationUri?: string; userCode?: string; message?: string; instructions?: string };
  prompt?: { id: string; type: string; message: string; placeholder?: string; options?: { id: string; label: string }[] };
};
type Props = { connectionMode: string; subscriptionProvider: string; subscriptionModel: string };
const field = 'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium disabled:opacity-50';
const initial: Provider[] = [
  { id: 'openai', name: 'ChatGPT', connected: false, models: [] },
  { id: 'anthropic', name: 'Anthropic Claude', connected: false, models: [] },
  { id: 'github-copilot', name: 'GitHub Copilot', connected: false, models: [] },
];
async function call(body?: object, session?: string) {
  const response = await fetch(`/api/ai/subscription${session ? `?session=${encodeURIComponent(session)}` : ''}`, body ? {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '订阅操作失败');
  return data;
}
export default function AiSubscriptionSettings(props: Props) {
  const [mode, setMode] = useState(props.connectionMode);
  const [provider, setProvider] = useState(props.subscriptionProvider);
  const [model, setModel] = useState(props.subscriptionModel);
  const [providers, setProviders] = useState(initial);
  const [available, setAvailable] = useState(false);
  const [login, setLogin] = useState<Login>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  async function refresh() {
    const state = await call();
    if (!mounted.current) return;
    setAvailable(state.available);
    setProviders(state.providers);
    if (state.login) setLogin(state.login);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(err => { if (mounted.current) setError(err.message); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!login || login.status !== 'pending') return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await call(undefined, login.id);
        if (stopped) return;
        setLogin(next);
        if (next.status !== 'pending') { clearInterval(timer); await refresh(); }
      } catch (err) { if (!stopped) { clearInterval(timer); setError((err as Error).message); } }
    }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [login?.id, login?.status]);
  useEffect(() => { setAnswer(login?.prompt?.type === 'select' ? login.prompt.options?.[0]?.id || '' : ''); }, [login?.prompt?.id]);
  const selected = providers.find(p => p.id === provider);
  async function action(body: object) {
    setBusy(true); setError('');
    try {
      const result = await call(body);
      if (result.id) setLogin(result);
      else await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const authUrl = login?.event?.url || login?.event?.verificationUri;
  const safeUrl = authUrl && /^https:\/\//i.test(authUrl) ? authUrl : undefined;
  return <div data-ai-subscription className="mt-4 space-y-3 rounded-xl border-2 border-foreground bg-background p-4">
    <label className="block text-sm font-medium">接入方式
      <select id="ai-connection-mode" className={field} value={mode} onChange={e => setMode(e.target.value)}>
        <option value="api">API 接入 · 保留原 URL 和密钥</option>
        <option value="subscription">订阅接入 · 文字聊天与技能编辑</option>
      </select>
    </label>
    <p className="text-xs leading-relaxed text-muted-foreground">两种方式均通过 Pi 调用。切换方式保留 API 配置、系统提示词和技能设置。订阅仅供站主在本地客户端使用；封面生成使用下方 API 配置并单独计费。</p>
    <div hidden={mode !== 'subscription'} className="space-y-3">
      {!available && <p className="text-xs text-muted-foreground">请在桌面端、Android 本地客户端或本地预览中登录订阅。</p>}
      <div className="grid gap-2 sm:grid-cols-3">{providers.map(p => <div key={p.id} className="rounded-lg border border-input p-3">
        <p className="text-sm font-semibold">{p.name}</p>
        <p className="my-2 text-xs text-muted-foreground">{p.connected ? '已连接 · 可测试模型' : '未连接'}</p>
        {p.error && <p className="mb-2 text-xs text-destructive">{p.error}</p>}
        <button type="button" className={button} disabled={!available || busy || login?.status === 'pending'} onClick={() => {
          if (!p.connected) setProvider(p.id);
          void action({ action: p.connected ? 'logout' : 'login', provider: p.id });
        }}>{p.connected ? <LogOut size={14} /> : <LogIn size={14} />}{p.connected ? '断开连接' : '订阅登录'}</button>
        {p.connected && <button type="button" className="mt-2 block text-xs underline" disabled={!available || busy || login?.status === 'pending'} onClick={() => void action({ action: 'login', provider: p.id })}>重新授权</button>}
        {p.id === 'openai' && !p.connected && <button type="button" className="mt-2 block text-xs underline" disabled={!available || busy || login?.status === 'pending'} onClick={() => void action({ action: 'login', provider: p.id, newAccount: true })}>连接其他 ChatGPT 账号</button>}
      </div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium">文字提供商
          <select id="ai-subscription-provider" className={field} value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }}>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium">文字模型
          <select id="ai-subscription-model" className={field} value={model} onChange={e => setModel(e.target.value)}>
            <option value="">登录后选择模型</option>
            {model && !selected?.models.some(m => m.id === model) && <option value={model}>{model}（请连接后验证）</option>}
            {selected?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">文章编辑继续按所选技能读取原始 SKILL.md，先生成修改预览，再由你应用。ChatGPT 订阅按平台额度使用，不支持通过此接口生图；回答长度由模型决定。</p>
      {login && <div className="space-y-2 rounded-lg border border-primary p-3" aria-live="polite">
        <p className="text-sm font-medium">{login.status === 'connected' ? '订阅已连接，请选择模型并保存' : login.status === 'pending' ? '等待订阅授权' : login.error || '登录已结束'}</p>
        {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" className={button}><ExternalLink size={14} />打开官方授权页面</a>}
        {login.event?.userCode && <p className="text-sm">授权码：<strong className="select-all">{login.event.userCode}</strong></p>}
        {login.event?.instructions && <p className="break-words text-xs">{login.event.instructions}</p>}
        {login.prompt && <form onSubmit={e => { e.preventDefault(); void action({ action: 'answer', session: login.id, prompt: login.prompt?.id, value: answer }); }}>
          <label className="block text-xs">{login.prompt.message}
            {login.prompt.type === 'select' ? <select className={field} value={answer} onChange={e => setAnswer(e.target.value)}>{login.prompt.options?.map(o => <option value={o.id} key={o.id}>{o.label}</option>)}</select>
              : <input className={field} type={login.prompt.type === 'secret' ? 'password' : 'text'} autoComplete="off" value={answer} placeholder={login.prompt.placeholder} onChange={e => setAnswer(e.target.value)} />}
          </label>
          <button className={`${button} mt-2`} disabled={busy || !answer.trim()}>提交授权信息</button>
        </form>}
        {login.status === 'pending' && <button type="button" className={button} disabled={busy} onClick={() => void action({ action: 'cancel', session: login.id })}><X size={14} />取消登录</button>}
      </div>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
