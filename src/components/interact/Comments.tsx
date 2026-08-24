/**
 * Comments.tsx —— 自建评论组件（React 岛，文章/动态复用）
 *
 * 交互（按需求）：
 * - 默认展开「前 6 条最热」评论，"更多"加载剩余；
 * - "N 条评论"旁折叠/展开按钮（折叠全部 / 展开默认 6 条）；
 * - "评论"按钮展开/折叠编辑区（匿名：昵称+内容；GitHub 登录：自动身份，无网址字段）；
 * - 每条评论可点赞（幂等取消）、可回复（任意层级，展示统一归并到顶级下平铺，
 *   回复非顶级评论时显示 "回复 @xxx"）、作者/管理员可删除；
 * - GitHub 登录：评论区提供入口，登录后以头像+昵称评论；
 * - 排序切换：最热 / 最新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, MessageSquare, ChevronDown, ChevronUp, Send, Trash2 } from 'lucide-react';
import { getLikeFingerprint } from '../../lib/like-fingerprint';
import LikeButton from './LikeButton';

/** 评论项（服务端返回形态） */
interface CommentItem {
  id: string;
  parentId: string | null;
  content: string;
  authorType: 'anonymous' | 'github';
  authorName: string;
  githubLogin?: string;
  githubAvatar?: string;
  likeCount: number;
  liked: boolean;
  mine: boolean;
  createdAt: string;
  replies?: CommentItem[];
  /** 被回复者名字（回复非顶级评论时显示） */
  replyToName?: string;
}

interface CommentsProps {
  targetType: 'article' | 'moment';
  targetId: string;
  /** SSR 注入的内容点赞初始数（防闪烁） */
  initialCount?: number;
}

const PAGE_SIZE = 6;

/** 相对时间 */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 头像（GitHub 头像 / 昵称首字） */
function Avatar({ item, size = 'sm' }: { item: CommentItem; size?: 'sm' | 'xs' }) {
  const cls = size === 'sm' ? 'size-7 text-xs' : 'size-5 text-[0.6rem]';
  if (item.authorType === 'github' && item.githubAvatar) {
    return (
      <img src={item.githubAvatar} alt="" loading="lazy" className={`${cls} shrink-0 rounded-full border border-border object-cover`} />
    );
  }
  const name = item.authorType === 'github' ? item.githubLogin ?? item.authorName : item.authorName || '匿';
  return (
    <span className={`${cls} inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-display font-semibold text-primary`}>
      {name.slice(0, 1)}
    </span>
  );
}

/** 单条评论（含回复与操作） */
function CommentRow({
  item,
  viewerGithub,
  isReply,
  replyToId,
  onReply,
  onLike,
  onDelete,
  onCancelReply,
  onSubmitReply,
  replyText,
  setReplyText,
  replyBusy,
}: {
  item: CommentItem;
  viewerGithub: boolean;
  isReply?: boolean;
  replyToId: string | null;
  onReply: (c: CommentItem) => void;
  onLike: (id: string) => void;
  onDelete: (id: string) => void;
  onCancelReply: () => void;
  onSubmitReply: () => void;
  replyText: string;
  setReplyText: (v: string) => void;
  replyBusy: boolean;
}) {
  const name =
    item.authorType === 'github' ? (item.githubLogin ?? 'GitHub 用户') : item.authorName || '匿名';
  return (
    <div className={isReply ? 'mt-2 pl-8' : 'mt-3'}>
      <div className={`flex items-start gap-2.5 rounded-lg p-2 transition-colors ${isReply ? 'bg-muted/40' : ''}`}>
        <Avatar item={item} size={isReply ? 'xs' : 'sm'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium text-foreground">{name}</span>
            {item.authorType === 'github' && (
              <span className="rounded bg-primary/10 px-1 py-px text-[0.6rem] text-primary">GitHub</span>
            )}
            {item.replyToName && (
              <span className="text-muted-foreground">
                回复 @<span className="text-primary">{item.replyToName}</span>
              </span>
            )}
            <time className="text-muted-foreground">{timeAgo(item.createdAt)}</time>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{item.content}</p>
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onLike(item.id)}
              aria-pressed={item.liked}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors ${
                item.liked ? 'text-primary' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              <Heart className={`size-3.5 ${item.liked ? 'fill-current' : ''}`} aria-hidden="true" />
              <span className="tabular-nums">{item.likeCount > 0 ? item.likeCount : ''}</span>
            </button>
            {/* 任意评论可回复（含回复的回复；展示统一归并到顶级下平铺） */}
            <button
              type="button"
              onClick={() => onReply(item)}
              className="rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-primary"
            >
              回复
            </button>
            {item.mine && (
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-destructive"
                aria-label="删除评论"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 回复编辑区（正在回复本条时显示，任意层级） */}
      {replyToId === item.id && (
        <div className="mt-2 pl-10">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="回复…"
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onSubmitReply()}
              disabled={replyBusy}
              className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              回复
            </button>
            <button type="button" onClick={onCancelReply} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 回复列表 */}
      {!isReply && item.replies && item.replies.length > 0 && (
        <div className="mt-1">
          {item.replies.map((r) => (
            <CommentRow
              key={r.id}
              item={r}
              viewerGithub={viewerGithub}
              isReply
              replyToId={replyToId}
              onReply={onReply}
              onLike={onLike}
              onDelete={onDelete}
              onCancelReply={onCancelReply}
              onSubmitReply={onSubmitReply}
              replyText={replyText}
              setReplyText={setReplyText}
              replyBusy={replyBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 评论区主组件 */
export default function Comments({ targetType, targetId, initialCount = 0 }: CommentsProps): React.ReactElement {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'hot' | 'latest'>('hot');
  const [collapsed, setCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [authorName, setAuthorName] = useState('');
  const [content, setContent] = useState('');
  const [replyText, setReplyText] = useState('');
  const [githubUser, setGithubUser] = useState<{ login: string; name: string; avatarUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  const load = useCallback(
    async (p: number, s: 'hot' | 'latest') => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          targetType,
          targetId,
          page: String(p),
          pageSize: String(PAGE_SIZE),
          sort: s,
          fingerprint: getLikeFingerprint(),
        });
        const res = await fetch(`/api/comments?${qs.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { comments: CommentItem[]; total: number; hasMore: boolean };
        if (!mounted.current) return;
        setItems((prev) => (p === 1 ? data.comments : [...prev, ...data.comments]));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(p);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [targetType, targetId],
  );

  // 初始加载 + GitHub 登录态
  useEffect(() => {
    mounted.current = true;
    fetch('/api/auth/user/me')
      .then((r) => (r.ok ? (r.json() as Promise<{ user: { login: string; name: string; avatarUrl: string } | null }>) : null))
      .then((d) => {
        if (d?.user && mounted.current) setGithubUser(d.user);
      })
      .catch(() => {});
    void load(1, 'hot');
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** 提交评论（顶级） */
  const submit = async (): Promise<void> => {
    if (busy) return;
    const text = content.trim();
    if (!text) {
      setError('内容不能为空');
      return;
    }
    if (!githubUser && !authorName.trim()) {
      setError('请填写昵称');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          parentId: null,
          content: text,
          authorName: githubUser ? undefined : authorName.trim(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? '发布失败');
        return;
      }
      setContent('');
      setEditorOpen(false);
      await load(1, sort);
    } finally {
      setBusy(false);
    }
  };

  /** 提交回复 */
  const submitReply = async (): Promise<void> => {
    if (!replyTo || replyBusy) return;
    const text = replyText.trim();
    if (!text) {
      setError('回复内容不能为空');
      return;
    }
    setReplyBusy(true);
    setError('');
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          parentId: replyTo.id,
          content: text,
          authorName: githubUser ? undefined : (authorName.trim() || undefined),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? '回复失败');
        return;
      }
      setReplyText('');
      setReplyTo(null);
      await load(1, sort);
    } finally {
      setReplyBusy(false);
    }
  };

  /** 评论点赞 */
  const likeComment = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/comments/${id}/like`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fingerprint: getLikeFingerprint() }),
      });
      if (!res.ok) return;
      const d = (await res.json()) as { liked: boolean; likeCount: number };
      setItems((prev) =>
        prev.map((t) => {
          if (t.id === id) return { ...t, liked: d.liked, likeCount: d.likeCount };
          if (t.replies) {
            return { ...t, replies: t.replies.map((r) => (r.id === id ? { ...r, liked: d.liked, likeCount: d.likeCount } : r)) };
          }
          return t;
        }),
      );
    } catch {
      /* 忽略 */
    }
  };

  /** 删除评论 */
  const del = async (id: string): Promise<void> => {
    if (!window.confirm('删除这条评论？')) return;
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
      if (res.ok) await load(1, sort);
    } catch {
      /* 忽略 */
    }
  };

  /** 切换排序并重载 */
  const changeSort = (s: 'hot' | 'latest'): void => {
    if (s === sort) return;
    setSort(s);
    void load(1, s);
  };

  return (
    <div className="mt-4">
      {/* 操作行：点赞（内容） + 评论按钮（编辑区）+ 评论数 + 折叠 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <LikeButton targetType={targetType} targetId={targetId} initialCount={initialCount} size="sm" />
        <button
          type="button"
          onClick={() => {
            setEditorOpen((o) => !o);
            setError('');
          }}
          aria-expanded={editorOpen}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-all duration-150 ${
            editorOpen
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
          }`}
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          {editorOpen ? '收起编辑' : '评论'}
        </button>
        <span className="text-sm font-medium">评论 {total > 0 ? total : ''}</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? '展开评论' : '折叠评论'}
          title={collapsed ? '展开评论' : '折叠评论'}
          className="inline-flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {(['hot', 'latest'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeSort(s)}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                sort === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              {s === 'hot' ? '最热' : '最新'}
            </button>
          ))}
        </div>
      </div>

      {!collapsed && (
        <div className="mt-3">
          {/* 编辑区折叠：点"评论"展开 */}
          {editorOpen && (
            <div className="rounded-lg border border-border bg-card p-3">
              {githubUser ? (
                <div className="flex items-center gap-2 text-sm">
                  <img src={githubUser.avatarUrl} alt="" className="size-6 rounded-full border border-border object-cover" />
                  <span className="font-medium">{githubUser.name || githubUser.login}</span>
                  <span className="rounded bg-primary/10 px-1 py-px text-[0.6rem] text-primary">GitHub</span>
                </div>
              ) : (
                <input
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  maxLength={50}
                  placeholder="昵称"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring"
                />
              )}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="写下你的评论…"
                className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="size-3.5" aria-hidden="true" />
                  发布
                </button>
                {!githubUser && (
                  <a
                    href={`/api/auth/user/github?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
                    </svg>
                    GitHub 登录
                  </a>
                )}
                {githubUser && (
                  <button
                    type="button"
                    onClick={() => {
                      void fetch('/api/auth/user/logout', { method: 'POST' }).then(() => {
                        setGithubUser(null);
                        window.location.reload();
                      });
                    }}
                    className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    退出
                  </button>
                )}
              </div>
              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </div>
          )}

          {/* 评论列表 */}
          <div className="mt-2">
            {loading && items.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">加载评论…</p>
            ) : items.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">还没有评论，来抢沙发～</p>
            ) : (
              items.map((c) => (
                <CommentRow
                  key={c.id}
                  item={c}
                  viewerGithub={!!githubUser}
                  replyToId={replyTo?.id ?? null}
                  onReply={(target) => {
                    setReplyTo(replyTo?.id === target.id ? null : target);
                    setReplyText('');
                    setError('');
                  }}
                  onLike={(id) => void likeComment(id)}
                  onDelete={(id) => void del(id)}
                  onCancelReply={() => setReplyTo(null)}
                  onSubmitReply={() => void submitReply()}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  replyBusy={replyBusy}
                />
              ))
            )}
            {hasMore && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => void load(page + 1, sort)}
                  disabled={loading}
                  className="rounded-full border border-border px-5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  更多评论
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
