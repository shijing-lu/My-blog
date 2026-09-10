/**
 * LiveEditor.tsx —— Obsidian 式写作工作区
 *
 * 三栏布局：
 * - 左栏：全部文章（按类型分组排序），支持新建 / 打开 / 删除 / 移动（改类型）；
 * - 中栏：MarkdownEditor（CodeMirror + Live Preview 所见即所得，复用组件）；
 * - 右栏：当前文章目录（点击跳转到对应标题）。
 * 500ms 防抖自动保存 /api/save-draft（版本防竞态、401 重登、beforeunload）；Ctrl/Cmd-S。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownEditor from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import MindMapEditor from '../mindmap/MindMapEditor';
import type { ArticleType } from '../../../db/types';
import { ARTICLE_TYPES } from '../../../db/types';
import { compressImageForUpload } from '../../lib/client-image-upload';
import { confirmDanger } from '../../lib/confirm';
import { countChars } from '../../lib/reading';

/** 初始草稿（服务端注入） */
export interface InitialDraft {
  id: string;
  title: string;
  type: ArticleType;
  summary: string;
  cover: string;
  tags: string[];
  content: string;
  /** 是否已启用加密（服务端状态） */
  encrypted?: boolean;
  /** 密码提示语（明文） */
  encryptHint?: string;
}

/** 文章元信息（左栏列表） */
export interface ArticleMeta {
  id: string;
  title: string;
  type: ArticleType;
  updatedAt: string;
}

/** 自定义分类（写作台可增删改排序） */
export interface ArticleCategory {
  id: string;
  name: string;
  /** 主题色（空串 = 跟随站点主色） */
  color: string;
  sort: number;
}

/** 组件 Props */
interface LiveEditorProps {
  initial: InitialDraft;
  articles: ArticleMeta[];
  /** 自定义分类（服务端注入；表未迁移时为空数组 → 回落到按类型分组） */
  categories?: ArticleCategory[];
  /** 文章 id → 分类 id 归属映射 */
  categoryMap?: Record<string, string>;
}

/** 保存状态 */
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'expired';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '未开始',
  dirty: '有修改…',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  expired: '登录已过期',
};

const TYPE_LABELS: Record<ArticleType, string> = { tech: '技术', note: '笔记', photo: '摄影' };

/** 从 Markdown 提取标题（行号供 CM 定位） */
function extractToc(md: string): Array<{ text: string; line: number; level: number }> {
  const out: Array<{ text: string; line: number; level: number }> = [];
  md.split('\n').forEach((line, idx) => {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ text: m[2]!, line: idx, level: m[1]!.length });
  });
  return out;
}

/** 写作工作区 */
export default function LiveEditor({ initial, articles, categories, categoryMap }: LiveEditorProps): ReactElement {
  const [draft, setDraft] = useState<InitialDraft>(initial);
  const [list, setList] = useState<ArticleMeta[]>(articles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /* ---- 自定义分类 ---- */
  const [cats, setCats] = useState<ArticleCategory[]>(categories ?? []);
  const [catMap, setCatMap] = useState<Record<string, string>>(categoryMap ?? {});
  /** 分类管理面板开关 */
  const [catPanelOpen, setCatPanelOpen] = useState(false);
  /** 新建分类输入框 */
  const [newCatName, setNewCatName] = useState('');
  /** 正在重命名的分类 id（内联编辑） */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState('');
  /** 左栏分组方式：自定义分类（默认） / 内置类型 */
  const [groupBy, setGroupBy] = useState<'category' | 'type'>((categories ?? []).length > 0 ? 'category' : 'type');
  /** 折叠的分组 key 集合 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 专注模式：隐藏左右栏，只留编辑器 */
  const [focusMode, setFocusMode] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);

  /* ---- 文章访问密码（服务端拦截）----
   * 语义（与 /api/save-draft 对齐，2026-09-10 由全文加密改造而来）：
   * - 勾选「访问密码」= 提交 `encrypt:true` + 密码 → 服务端存**密码哈希**；
   *   正文始终明文入库，不做加密。
   * - 已设置密码的文章继续编辑：密码框留空即可（服务端沿用旧哈希），
   *   填新密码则更换密码。
   * - 取消勾选 = 提交 `encrypt:'disable'`，文章恢复公开。 */
  const [encryptOn, setEncryptOn] = useState<boolean>(Boolean(initial.encrypted));
  const [encryptPassword, setEncryptPassword] = useState('');
  /** 密码框默认**明文显示**（站主要能随时核对密码）；点眼睛图标可临时打码 */
  const [showPassword, setShowPassword] = useState(true);
  const [encryptHint, setEncryptHint] = useState(initial.encryptHint ?? '');
  const [cryptoMsg, setCryptoMsg] = useState('');
  // 用 ref 保存最新值供防抖保存读取（避免闭包陈旧）
  const cryptoRef = useRef({ encryptOn, encryptPassword, encryptHint });
  cryptoRef.current = { encryptOn, encryptPassword, encryptHint };

  const [mapOpen, setMapOpen] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ id: string; title: string; data: string } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<number | null>(null);
  const versionRef = useRef(0);

  /* ---- 保存 ---- */
  const saveNow = useCallback(async (): Promise<void> => {
    const v = ++versionRef.current;
    setSaveStatus('saving');
    try {
      const c = cryptoRef.current;
      // 构造请求体：访问密码字段按状态注入（见 resolveEncryption 的语义说明）
      const payload: Record<string, unknown> = { ...draftRef.current };
      delete payload.encrypted;
      delete payload.encryptHint;
      // ⚠️ 正文**始终提交**（勿回退）：服务端拦截模式下正文明文入库，
      // 旧实现「加密时删除 content」会让服务端拿到空串 → 正文被清空（线上事故）。
      if (c.encryptOn) {
        // 首次勾选但尚未输入密码时，不能立刻提交 encrypt:true：
        // 服务端会以「请设置访问密码」400 拒绝。此处保持「未勾选」语义，
        // 待用户输入密码后再由 password 的 onChange → scheduleSave 提交。
        const ready = Boolean(c.encryptPassword) || Boolean(draftRef.current.encrypted);
        if (ready) {
          payload.encrypt = true;
          payload.encryptHint = c.encryptHint;
          // 仅在用户输入了新密码时提交；否则服务端沿用旧哈希
          if (c.encryptPassword) payload.encryptPassword = c.encryptPassword;
          else delete payload.encryptPassword;
        }
      } else {
        payload.encrypt = 'disable';
      }

      const res = await fetch('/api/save-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        if (v === versionRef.current) setSaveStatus('expired');
        return;
      }
      if (!res.ok) {
        // 400 多为密码强度等可展示的业务错误
        if (res.status === 400) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          if (d.error && v === versionRef.current) setCryptoMsg(d.error);
        }
        if (v === versionRef.current) setSaveStatus('error');
        return;
      }
      if (v === versionRef.current) {
        setCryptoMsg('');
        setSaveStatus('saved');
        setLastSaved(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        // 注：保存成功后**不清空密码框**——站主要能随时看到自己设的密码，
        // 自动清空会让「改标题」等操作后误以为密码丢了。密码框内容仅存在于
        // 当前页面内存中，不会持久化，刷新即重置。
        const d = draftRef.current;
        setList((prev) => {
          const exists = prev.some((x) => x.id === d.id);
          const item: ArticleMeta = { id: d.id, title: d.title || '未命名', type: d.type, updatedAt: new Date().toISOString() };
          return exists ? prev.map((x) => (x.id === d.id ? item : x)) : [...prev, item];
        });
      }
    } catch {
      if (v === versionRef.current) setSaveStatus('error');
    }
  }, []);

  const scheduleSave = useCallback((): void => {
    setSaveStatus('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNow();
    }, 500);
  }, [saveNow]);

  const update = useCallback(
    <K extends keyof InitialDraft>(key: K, value: InitialDraft[K]): void => {
      setDraft((d) => ({ ...d, [key]: value }));
      scheduleSave();
    },
    [scheduleSave],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (saveStatus === 'dirty' || saveStatus === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  /** 导图面板：打开时加载该文章的思维导图（无则显示创建入口） */
  useEffect(() => {
    if (!mapOpen) return;
    let cancelled = false;
    setMapLoading(true);
    setMapError('');
    void (async () => {
      try {
        const res = await fetch(`/api/mindmaps?articleId=${encodeURIComponent(draft.id)}`);
        const d = (await res.json()) as { maps?: { id: string; title: string }[] };
        const list = d.maps ?? [];
        if (list.length > 0) {
          const full = await fetch(`/api/mindmaps/${list[0]!.id}`);
          const fd = (await full.json()) as { map?: { id: string; title: string; data: unknown } };
          if (fd.map && !cancelled) {
            setMapInfo({ id: fd.map.id, title: fd.map.title, data: JSON.stringify(fd.map.data) });
          }
        } else if (!cancelled) {
          setMapInfo(null);
        }
      } catch {
        if (!cancelled) setMapError('加载思维导图失败');
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapOpen, draft.id]);

  /** 为当前文章创建思维导图 */
  const createMap = useCallback(async (): Promise<void> => {
    setMapLoading(true);
    setMapError('');
    try {
      const res = await fetch('/api/mindmaps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: draftRef.current.title || '思维导图', articleId: draftRef.current.id }),
      });
      const d = (await res.json()) as { map?: { id: string; title: string } };
      if (!res.ok || !d.map) {
        setMapError('创建失败，请重试');
        return;
      }
      const full = await fetch(`/api/mindmaps/${d.map.id}`);
      const fd = (await full.json()) as { map?: { id: string; title: string; data: unknown } };
      if (fd.map) setMapInfo({ id: fd.map.id, title: fd.map.title, data: JSON.stringify(fd.map.data) });
    } catch {
      setMapError('创建失败，请重试');
    } finally {
      setMapLoading(false);
    }
  }, []);

  /** 从编辑器选中文本添加引用节点（snippet 引用，无锚点；发布后按文本匹配定位） */
  const addRefFromEditor = useCallback(async (): Promise<void> => {
    const text = editorRef.current?.getSelectionText() ?? '';
    if (!text) {
      window.alert('请先在编辑器里选中一段文字，再点「＋ 引用选区」');
      return;
    }
    if (!mapInfo) {
      window.alert('请先创建思维导图');
      return;
    }
    const name = window.prompt('引用名称（节点显示用，不是粘贴全文）', text.slice(0, 30));
    if (name === null) return;
    const title = name.trim();
    if (!title) return;
    setMapLoading(true);
    try {
      const res = await fetch(`/api/mindmaps/${mapInfo.id}/refs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: title, snippet: text.slice(0, 500) }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(d.error ?? '添加引用失败');
        return;
      }
      // 重新拉取数据刷新画布（initialData 变化 → 编辑器重新挂载显示新节点）
      const full = await fetch(`/api/mindmaps/${mapInfo.id}`);
      const fd = (await full.json()) as { map?: { data: unknown } };
      const nextData = fd.map?.data;
      if (nextData !== undefined) setMapInfo((prev) => (prev ? { ...prev, data: JSON.stringify(nextData) } : prev));
      window.alert('已添加引用节点');
    } catch {
      window.alert('添加引用失败');
    } finally {
      setMapLoading(false);
    }
  }, [mapInfo]);

  /* ---- 打开 / 删除 / 移动 ---- */
  const loadArticle = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { article: InitialDraft };
    setDraft({ ...data.article, cover: data.article.cover ?? '', tags: data.article.tags ?? [] });
    setSelectedId(id);
    setSaveStatus('saved');
    setLastSaved(null);
  }, []);

  const newArticle = useCallback((): void => {
    window.location.href = '/edit/new';
  }, []);

  const removeArticle = useCallback(async (id: string): Promise<void> => {
    const target = list.find((x) => x.id === id);
    if (!target) return;
    if (!(await confirmDanger(`确定删除「${target.title}」？此操作不可撤销。`))) return;
    await fetch(`/api/articles/${id}`, { method: 'DELETE' });
    setList((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDraft({ id: crypto.randomUUID(), title: '', type: 'tech', summary: '', cover: '', tags: [], content: '' });
      setSaveStatus('idle');
      setLastSaved(null);
    }
  }, [list, selectedId]);

  const moveArticle = useCallback(async (id: string, type: ArticleType): Promise<void> => {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { article: InitialDraft };
    await fetch('/api/save-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data.article, type, tags: data.article.tags ?? [] }),
    });
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, type } : x)));
    if (selectedId === id) setDraft((d) => ({ ...d, type }));
  }, [selectedId]);

  /* ---- 自定义分类 CRUD（/api/article-categories） ---- */
  /**
   * 统一请求：返回**已解析**的 JSON（响应体只能读一次，故在此处 json() 后回传数据，
   * 调用方不要再 res.json()）。失败时把服务端文案回显到面板。
   */
  const catRequest = useCallback(
    async (init: RequestInit): Promise<{ ok: boolean; data: { error?: string; category?: ArticleCategory } }> => {
      setCatBusy(true);
      setCatError('');
      try {
        const res = await fetch('/api/article-categories', {
          headers: { 'content-type': 'application/json' },
          ...init,
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string; category?: ArticleCategory };
        if (!res.ok) {
          setCatError(d.error ?? '操作失败');
          return { ok: false, data: d };
        }
        return { ok: true, data: d };
      } catch {
        setCatError('网络错误，请重试');
        return { ok: false, data: {} };
      } finally {
        setCatBusy(false);
      }
    },
    [],
  );

  const createCategory = useCallback(async (): Promise<void> => {
    const name = newCatName.trim();
    if (!name) return;
    const { ok, data } = await catRequest({ method: 'POST', body: JSON.stringify({ name }) });
    if (!ok) return;
    if (data.category) {
      setCats((prev) => [...prev, data.category!]);
      // 新建后若左栏还在「按类型分组」，自动切到分类视图让用户看到成果
      setGroupBy('category');
    }
    setNewCatName('');
  }, [newCatName, catRequest]);

  const renameCategory = useCallback(
    async (id: string, name: string): Promise<void> => {
      const { ok } = await catRequest({ method: 'PATCH', body: JSON.stringify({ id, name }) });
      if (!ok) return;
      setCats((prev) => prev.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
      setRenamingId(null);
    },
    [catRequest],
  );

  /** 上移 / 下移：交换相邻两项 → 整序提交 */
  const moveCategory = useCallback(
    async (id: string, dir: -1 | 1): Promise<void> => {
      const idx = cats.findIndex((c) => c.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= cats.length) return;
      const ordered = [...cats];
      const [item] = ordered.splice(idx, 1);
      if (!item) return;
      ordered.splice(next, 0, item);
      const { ok } = await catRequest({ method: 'PATCH', body: JSON.stringify({ ids: ordered.map((c) => c.id) }) });
      if (!ok) return;
      setCats(ordered.map((c, i) => ({ ...c, sort: i })));
    },
    [cats, catRequest],
  );

  const removeCategory = useCallback(
    async (id: string): Promise<void> => {
      const target = cats.find((c) => c.id === id);
      if (!target) return;
      const used = Object.values(catMap).filter((v) => v === id).length;
      const msg =
        used > 0
          ? `删除分类「${target.name}」？其下 ${used} 篇文章将归入「未分类」（文章不会被删除）。`
          : `确定删除分类「${target.name}」？`;
      if (!(await confirmDanger(msg))) return;
      const { ok } = await catRequest({ method: 'DELETE', body: JSON.stringify({ id }) });
      if (!ok) return;
      setCats((prev) => prev.filter((c) => c.id !== id));
      setCatMap((prev) => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([k, v]) => {
          if (v !== id) next[k] = v;
        });
        return next;
      });
    },
    [cats, catMap, catRequest],
  );

  /** 设置指定文章的所属分类（空串 = 解除归属，归入「未分类」） */
  const setArticleCategoryOf = useCallback(
    async (articleId: string, categoryId: string): Promise<void> => {
      const { ok } = await catRequest({
        method: 'PATCH',
        body: JSON.stringify({ articleId, categoryId: categoryId || null }),
      });
      if (!ok) return;
      setCatMap((prev) => {
        const next = { ...prev };
        if (categoryId) next[articleId] = categoryId;
        else delete next[articleId];
        return next;
      });
    },
    [catRequest],
  );

  /** 设置当前正在编辑文章的所属分类 */
  const setCurrentCategory = useCallback(
    async (categoryId: string): Promise<void> => {
      await setArticleCategoryOf(draftRef.current.id, categoryId);
    },
    [setArticleCategoryOf],
  );

  /* ---- 封面上传 ---- */
  const handleCoverFile = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        const { base64, mime } = await compressImageForUpload(file);
        const res = await fetch('/api/images', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, mime, data: base64 }),
        });
        if (!res.ok) throw new Error('上传失败');
        const out = (await res.json()) as { url?: string; error?: string };
        if (!out.url) throw new Error(out.error ?? '上传失败');
        update('cover', out.url);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '封面上传失败');
      } finally {
        setUploading(false);
      }
    },
    [update],
  );

  /** 跳转目录对应标题行 */
  const jumpToHeading = useCallback((line: number): void => {
    editorRef.current?.jumpToLine(line);
  }, []);

  /** 当前文章目录 */
  const toc = useMemo(() => extractToc(draft.content), [draft.content]);

  /** 按类型分组（更新时间倒序） */
  const groups = useMemo(() => {
    const g: Record<ArticleType, ArticleMeta[]> = { tech: [], note: [], photo: [] };
    [...list]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .forEach((a) => g[a.type]?.push(a));
    return g;
  }, [list]);

  /** 按自定义分类分组（末尾固定「未分类」兜底组，承接无归属/分类已删的文章） */
  const catGroups = useMemo(() => {
    const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const known = new Set(cats.map((c) => c.id));
    const out: Array<{ key: string; name: string; color: string; items: ArticleMeta[] }> = cats.map((c) => ({
      key: `cat:${c.id}`,
      name: c.name,
      color: c.color,
      items: sorted.filter((a) => catMap[a.id] === c.id),
    }));
    out.push({
      key: 'cat:none',
      name: '未分类',
      color: '',
      items: sorted.filter((a) => !catMap[a.id] || !known.has(catMap[a.id]!)),
    });
    return out;
  }, [list, cats, catMap]);

  /** 折叠/展开分组 */
  const toggleGroup = useCallback((key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏：全部文章（按自定义分类 / 内置类型分组） */}
      {!focusMode && (
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <span className="pixel-chip text-muted-foreground">全部文章</span>
            <button
              type="button"
              onClick={newArticle}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:opacity-90 active:scale-95"
            >
              + 新建
            </button>
          </div>

          {/* 分组方式切换 + 分类管理入口 */}
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
            <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="分组方式">
              <button
                type="button"
                onClick={() => setGroupBy('category')}
                disabled={cats.length === 0}
                title={cats.length === 0 ? '还没有自定义分类，点右侧「管理」新建' : '按自定义分类分组'}
                className={`px-2 py-1 text-[0.7rem] transition-colors disabled:opacity-40 ${
                  groupBy === 'category' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                分类
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('type')}
                className={`px-2 py-1 text-[0.7rem] transition-colors ${
                  groupBy === 'type' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                类型
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCatPanelOpen(true)}
              className="ml-auto rounded-md border border-border px-2 py-1 text-[0.7rem] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              title="新建 / 重命名 / 排序 / 删除分类"
            >
              ⚙ 管理分类
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
            {groupBy === 'category'
              ? catGroups.map((g) => {
                  const open = !collapsed.has(g.key);
                  return (
                    <div key={g.key} className="mb-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.key)}
                        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[0.7rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        aria-expanded={open}
                      >
                        <span className={`text-[0.55rem] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
                        {g.color ? (
                          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                        ) : null}
                        <span className="truncate">{g.name}</span>
                        <span className="ml-auto font-pixel text-[0.6rem] opacity-60">{g.items.length}</span>
                      </button>
                      {open && (
                        <ul>
                          {g.items.map((a) => (
                            <li key={a.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => void loadArticle(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void loadArticle(a.id);
                                }}
                                className={`group/item relative flex cursor-pointer items-center gap-1 py-1.5 pl-3 pr-2 text-sm transition-colors duration-200 ${
                                  selectedId === a.id ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
                                }`}
                              >
                                {selectedId === a.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                                <span className="min-w-0 flex-1 truncate">{a.title || '未命名'}</span>
                                <span className="hidden shrink-0 items-center gap-1 group-hover/item:flex" onClick={(e) => e.stopPropagation()}>
                                  <select
                                    value={catMap[a.id] ?? ''}
                                    onChange={(e) => void setArticleCategoryOf(a.id, e.target.value)}
                                    className="w-16 cursor-pointer rounded border border-border bg-background px-1 py-0.5 text-[0.6rem]"
                                    aria-label="移动分类"
                                    title="移动分类"
                                  >
                                    <option value="">未分类</option>
                                    {cats.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void removeArticle(a.id);
                                    }}
                                    className="text-destructive"
                                    aria-label="删除"
                                    title="删除"
                                  >
                                    ×
                                  </button>
                                </span>
                              </div>
                            </li>
                          ))}
                          {g.items.length === 0 && (
                            <li className="px-3 py-0.5 text-[0.65rem] text-muted-foreground/60">（空）</li>
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })
              : ARTICLE_TYPES.map((type) => {
                  const key = `type:${type}`;
                  const open = !collapsed.has(key);
                  return (
                    <div key={type} className="mb-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[0.7rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        aria-expanded={open}
                      >
                        <span className={`text-[0.55rem] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
                        <span className="truncate">{TYPE_LABELS[type]}</span>
                        <span className="ml-auto font-pixel text-[0.6rem] opacity-60">{groups[type]?.length ?? 0}</span>
                      </button>
                      {open && (
                        <ul>
                          {groups[type]?.map((a) => (
                            <li key={a.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => void loadArticle(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void loadArticle(a.id);
                                }}
                                className={`group/item relative flex cursor-pointer items-center gap-1 py-1.5 pl-3 pr-2 text-sm transition-colors duration-200 ${
                                  selectedId === a.id ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
                                }`}
                              >
                                {selectedId === a.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                                <span className="min-w-0 flex-1 truncate">{a.title || '未命名'}</span>
                                <span className="hidden shrink-0 items-center gap-1 group-hover/item:flex" onClick={(e) => e.stopPropagation()}>
                                  <select
                                    value={a.type}
                                    onChange={(e) => void moveArticle(a.id, e.target.value as ArticleType)}
                                    className="w-14 cursor-pointer rounded border border-border bg-background px-1 py-0.5 font-pixel text-[0.55rem]"
                                    aria-label="移动分组"
                                    title="移动分组"
                                  >
                                    {ARTICLE_TYPES.map((t) => (
                                      <option key={t} value={t}>
                                        {TYPE_LABELS[t]}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void removeArticle(a.id);
                                    }}
                                    className="text-destructive"
                                    aria-label="删除"
                                    title="删除"
                                  >
                                    ×
                                  </button>
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
          </div>
        </aside>
      )}

      {/* 分类管理面板（新建 / 重命名 / 排序 / 删除） */}
      {catPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCatPanelOpen(false)}>
          <div
            className="w-[22rem] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div>
                <p className="pixel-chip text-primary">CATEGORIES</p>
                <h3 className="text-sm font-medium">分类管理</h3>
              </div>
              <button
                type="button"
                onClick={() => setCatPanelOpen(false)}
                className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
              {cats.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有自定义分类，在下面输入名称新建一个。</p>
              ) : (
                <ul className="space-y-1">
                  {cats.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1.5">
                      {c.color ? (
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                      ) : (
                        <span className="size-2 shrink-0 rounded-full bg-primary/40" />
                      )}
                      {renamingId === c.id ? (
                        <input
                          autoFocus
                          value={renamingName}
                          onChange={(e) => setRenamingName(e.target.value)}
                          onBlur={() => setRenamingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void renameCategory(c.id, renamingName);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus-visible:border-ring"
                        />
                      ) : (
                        <span
                          className="min-w-0 flex-1 cursor-text truncate text-xs"
                          title="双击重命名"
                          onDoubleClick={() => {
                            setRenamingId(c.id);
                            setRenamingName(c.name);
                          }}
                        >
                          {c.name}
                        </span>
                      )}
                      <span className="font-pixel text-[0.6rem] text-muted-foreground/60">
                        {Object.values(catMap).filter((v) => v === c.id).length}
                      </span>
                      <button
                        type="button"
                        onClick={() => void moveCategory(c.id, -1)}
                        disabled={i === 0 || catBusy}
                        className="rounded px-1 text-[0.7rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                        title="上移"
                        aria-label="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveCategory(c.id, 1)}
                        disabled={i === cats.length - 1 || catBusy}
                        className="rounded px-1 text-[0.7rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                        title="下移"
                        aria-label="下移"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenamingName(c.name);
                        }}
                        className="rounded px-1 text-[0.7rem] text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                        title="重命名"
                        aria-label="重命名"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeCategory(c.id)}
                        className="rounded px-1 text-[0.7rem] text-destructive transition-colors hover:bg-destructive/10"
                        title="删除分类"
                        aria-label="删除分类"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createCategory();
                  }}
                  placeholder="新分类名称…"
                  maxLength={30}
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring"
                />
                <button
                  type="button"
                  onClick={() => void createCategory()}
                  disabled={catBusy || !newCatName.trim()}
                  className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  添加
                </button>
              </div>
              {catError ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  {catError}
                </p>
              ) : (
                <p className="mt-2 text-[0.7rem] text-muted-foreground">双击名称可重命名 · ↑↓ 调整顺序 · 删除后文章归入「未分类」</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 中栏：MarkdownEditor（所见即所得） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 元信息工具条 */}
        <div className="shrink-0 space-y-2.5 border-b bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="标题"
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-lg font-semibold outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/40 focus-visible:border-ring focus-visible:bg-background"
            />
            <select
              value={draft.type}
              onChange={(e) => update('type', e.target.value as ArticleType)}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring"
              aria-label="文章类型（移动分组）"
              title="类型 = 移动分组"
            >
              {ARTICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={catMap[draft.id] ?? ''}
              onChange={(e) => void setCurrentCategory(e.target.value)}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring"
              aria-label="自定义分类"
              title="自定义分类（在左栏「管理分类」里增删改）"
            >
              <option value="">未分类</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <input
              value={draft.summary}
              onChange={(e) => update('summary', e.target.value)}
              placeholder="摘要（列表与搜索展示）"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
            <input
              value={draft.tags.join(', ')}
              onChange={(e) => update('tags', e.target.value.split(',').map((s) => s.trim()))}
              placeholder="标签，逗号分隔"
              className="w-52 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="pixel-chip shrink-0 text-muted-foreground">封面</span>
            <input
              value={draft.cover}
              onChange={(e) => update('cover', e.target.value)}
              placeholder="封面图 URL（留空 = 自动取正文首图）"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
            />
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCoverFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => coverFileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-md border border-border px-2.5 py-1.5 transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
              title="上传封面图"
              aria-label="上传封面图"
            >
              {uploading ? '上传中…' : '上传封面'}
            </button>
            {draft.cover ? (
              <button
                type="button"
                onClick={() => update('cover', '')}
                className="text-destructive hover:underline"
                title="清除封面，回落到正文首图"
              >
                清除
              </button>
            ) : null}
          </div>

          {/* 文章加密 */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 select-none">
              <input
                type="checkbox"
                checked={encryptOn}
                onChange={(e) => {
                  const on = e.target.checked;
                  setEncryptOn(on);
                  setCryptoMsg('');
                  // 切换加密状态 → 立即触发一次保存，让服务端同步落库
                  scheduleSave();
                }}
                className="size-3.5 accent-primary"
              />
              <span className={encryptOn ? 'text-primary' : undefined}>访问密码</span>
            </label>

            {encryptOn ? (
              <>
                <div className="relative min-w-0 flex-1">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={encryptPassword}
                    onChange={(e) => {
                      setEncryptPassword(e.target.value);
                      setCryptoMsg('');
                      // 输入密码后才真正提交加密：勾选加密本身不再立即落库
                      scheduleSave();
                    }}
                    placeholder={
                      draft.encrypted ? '留空保留原密码，输入则更换' : '设置访问密码（长度不限）'
                    }
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-3 pr-9 outline-none transition-colors focus-visible:border-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.3 17.3 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 5.4-1.4" />
                        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                        <path d="m2 2 20 20" />
                      </svg>
                    ) : (
                      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <input
                  value={encryptHint}
                  onChange={(e) => {
                    setEncryptHint(e.target.value);
                    scheduleSave();
                  }}
                  placeholder="密码提示（可选，会展示给访客）"
                  className="w-52 rounded-md border border-input bg-background px-3 py-1.5 outline-none transition-colors focus-visible:border-ring"
                />
              </>
            ) : null}

            {draft.encrypted && encryptOn ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-600">
                <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                已设密码
              </span>
            ) : null}
            {/* 勾选但尚未输入密码（且原本未加密）：提示还需填密码才会生效 */}
            {encryptOn && !draft.encrypted && !encryptPassword ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-600">
                待输入密码后生效
              </span>
            ) : null}
          </div>
          {cryptoMsg ? (
            <p className="text-xs text-destructive" role="alert">
              {cryptoMsg}
            </p>
          ) : null}

          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 ${
                saveStatus === 'saved'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : saveStatus === 'error' || saveStatus === 'expired'
                    ? 'bg-destructive/10 text-destructive'
                    : saveStatus === 'saving'
                      ? 'bg-amber-500/10 text-amber-600'
                      : 'bg-muted text-muted-foreground'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  saveStatus === 'saved'
                    ? 'bg-emerald-500'
                    : saveStatus === 'error' || saveStatus === 'expired'
                      ? 'bg-destructive'
                      : saveStatus === 'saving'
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/40'
                }`}
              />
              {STATUS_TEXT[saveStatus]}
            </span>
            {lastSaved ? <span className="text-muted-foreground">上次保存 {lastSaved}</span> : null}
            <span className="text-muted-foreground/70 tabular-nums">{countChars(draft.content)} 字</span>
            {saveStatus === 'expired' ? (
              <a href="/login?next=/admin" className="text-primary underline underline-offset-2">
                重新登录
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setMapOpen((o) => !o)}
              className={`ml-auto rounded-md border px-2.5 py-1 transition-colors duration-200 ${
                mapOpen
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
              }`}
              title="展开/收起思维导图面板"
            >
              🧭 导图
            </button>
            <button
              type="button"
              onClick={() => setFocusMode((f) => !f)}
              className={`rounded-md border px-2.5 py-1 transition-colors duration-200 ${
                focusMode
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
              }`}
              title={focusMode ? '退出专注模式（显示左右栏）' : '专注模式：只留编辑器'}
            >
              {focusMode ? '⤢ 退出专注' : '⤡ 专注'}
            </button>
          </div>
        </div>

        {/* 工作区：编辑器 + 思维导图 左右分栏 */}
        <div className="flex min-h-0 flex-1">
          {/* 所见即所得编辑器（复用 MarkdownEditor） */}
          <MarkdownEditor
            ref={editorRef}
            initialContent={draft.content}
            onChange={(c) => update('content', c)}
            onSave={() => void saveNow()}
            className="min-h-0 min-w-0 flex-1"
          />

          {/* 导图面板：边写文章边编辑思维导图（右栏） */}
          {mapOpen && (
            <div className="flex w-[46%] min-w-0 shrink-0 flex-col border-l">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium">思维导图</span>
                  {mapInfo && (
                    <button
                      type="button"
                      onClick={() => void addRefFromEditor()}
                      className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      title="先在编辑器选中一段文字，再点击添加引用节点"
                    >
                      ＋ 引用选区
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span className="truncate">{mapLoading ? '加载中…' : mapInfo ? mapInfo.title : '未创建'}</span>
                  <button type="button" onClick={() => setMapOpen(false)} className="transition-colors hover:text-foreground">
                    收起
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {mapLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中…</div>
                ) : mapInfo ? (
                  <MindMapEditor mapId={mapInfo.id} initialTitle={mapInfo.title} initialData={mapInfo.data} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span>{mapError || '这篇文章还没有思维导图'}</span>
                    <button
                      type="button"
                      onClick={() => void createMap()}
                      className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      + 创建思维导图
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右栏：目录 */}
      <aside className={`hidden w-56 shrink-0 border-l bg-muted/20 xl:block ${focusMode ? 'xl:hidden' : ''}`}>
        <div className="border-b px-3 py-2">
          <span className="pixel-chip text-muted-foreground">目录 / TOC</span>
        </div>
        <div className="max-h-full overflow-y-auto py-2">
          {toc.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">暂无标题 —— 用 # 开始一个标题。</p>
          ) : (
            toc.map((t, i) => (
              <button
                key={`${t.text}-${i}`}
                type="button"
                onClick={() => jumpToHeading(t.line)}
                className={`block w-full truncate px-3 py-1 text-left text-sm transition-colors duration-200 hover:bg-accent ${
                  t.level >= 3 ? 'pl-7' : ''
                }`}
              >
                {t.text}
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
