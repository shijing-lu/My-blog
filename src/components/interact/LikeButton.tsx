/**
 * LikeButton.tsx —— 内容点赞按钮（React 岛，文章/动态复用）
 *
 * - 身份：匿名（浏览器指纹）/ GitHub 登录（Twikoo token 哈希）分开计数；
 * - 普通访客看到总和；管理员（summary 返回拆分字段）看到「总 / 匿名 / GitHub」三组；
 * - 点击 toggle 幂等（赞↔取消）、乐观更新、失败回滚；样式与博客主题统一。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { getLikeIdentity } from '../../lib/like-fingerprint';

interface LikeButtonProps {
  /** 目标类型：article | moment */
  targetType: 'article' | 'moment';
  /** 目标 id */
  targetId: string;
  /** SSR 注入的初始点赞数（防闪烁） */
  initialCount?: number;
  /** 尺寸 */
  size?: 'sm' | 'md';
}

interface Summary {
  total: number;
  liked: boolean;
  /** 管理员专属：拆分计数（普通访客响应无此字段） */
  anonymous?: number;
  github?: number;
}

/** 点赞数格式化：>=1000 显示 1k */
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export default function LikeButton({ targetType, targetId, initialCount = 0, size = 'md' }: LikeButtonProps): React.ReactElement {
  const [liked, setLiked] = useState(false);
  const [total, setTotal] = useState(initialCount);
  const [split, setSplit] = useState<{ anonymous?: number; github?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const { userType, userIdent } = getLikeIdentity();
    const qs = new URLSearchParams({
      targetType,
      targetId,
      userType,
      userIdent,
    });
    fetch(`/api/likes/summary?${qs.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<Summary>) : null))
      .then((data) => {
        if (data && mounted.current) {
          setLiked(data.liked);
          setTotal(data.total);
          // 管理员响应含 anonymous/github → 显示拆分
          if (typeof data.anonymous === 'number' && typeof data.github === 'number') {
            setSplit({ anonymous: data.anonymous, github: data.github });
          }
        }
      })
      .catch(() => {
        /* 忽略：保持 SSR 初始值 */
      });
    return () => {
      mounted.current = false;
    };
  }, [targetType, targetId]);

  const toggle = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const prevLiked = liked;
    const prevTotal = total;
    // 乐观更新
    setLiked(!prevLiked);
    setTotal(prevLiked ? Math.max(0, prevTotal - 1) : prevTotal + 1);
    try {
      const { userType, userIdent } = getLikeIdentity();
      const res = await fetch('/api/likes/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, userType, userIdent }),
      });
      if (!res.ok) throw new Error('toggle failed');
      const data = (await res.json()) as { liked: boolean; count: number };
      if (mounted.current) {
        setLiked(data.liked);
        setTotal(data.count);
      }
    } catch {
      // 失败回滚
      if (mounted.current) {
        setLiked(prevLiked);
        setTotal(prevTotal);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, liked, total, targetType, targetId]);

  const sizeCls = size === 'sm' ? 'gap-1 px-2.5 py-1 text-xs' : 'gap-1.5 px-3.5 py-1.5 text-sm';

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={liked}
      aria-label={liked ? '取消点赞' : '点赞'}
      className={`group inline-flex items-center rounded-full border transition-all duration-150 active:scale-95 ${
        liked
          ? 'border-primary/60 bg-primary/10 text-primary shadow-[0_0_12px_-2px] shadow-primary/40'
          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary hover:shadow-[0_0_10px_-3px] hover:shadow-primary/30'
      } ${sizeCls}`}
    >
      <Heart
        className={`size-4 transition-transform duration-150 group-hover:scale-110 ${liked ? 'fill-current' : ''}`}
        aria-hidden="true"
      />
      <span className="tabular-nums">{formatCount(total)}</span>
      {split && (
        <span className="ml-1 hidden rounded-full bg-muted px-1.5 py-0.5 text-[0.6rem] leading-none text-muted-foreground sm:inline">
          匿 {split.anonymous ?? 0} · GH {split.github ?? 0}
        </span>
      )}
    </button>
  );
}
