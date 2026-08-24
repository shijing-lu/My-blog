/**
 * LikeButton.tsx —— 内容点赞按钮（React 岛，文章/动态复用）
 *
 * - 匿名指纹（localStorage UUID）标识用户；点击 toggle 点赞↔取消；
 * - 挂载后以服务端 summary 为准校正（liked + count）；
 * - 乐观更新、失败回滚；样式与博客按钮体系一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { getLikeFingerprint } from '../../lib/like-fingerprint';

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

/** 点赞数格式化：>=1000 显示 1k */
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export default function LikeButton({ targetType, targetId, initialCount = 0, size = 'md' }: LikeButtonProps): React.ReactElement {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const fp = getLikeFingerprint();
    fetch(`/api/likes/summary?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&fingerprint=${encodeURIComponent(fp)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number; liked: boolean }>) : null))
      .then((data) => {
        if (data && mounted.current) {
          setLiked(data.liked);
          setCount(data.count);
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
    // 乐观更新
    const prevLiked = liked;
    const prevCount = count;
    setLiked(!prevLiked);
    setCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    try {
      const res = await fetch('/api/likes/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, fingerprint: getLikeFingerprint() }),
      });
      if (!res.ok) throw new Error('toggle failed');
      const data = (await res.json()) as { liked: boolean; count: number };
      if (mounted.current) {
        setLiked(data.liked);
        setCount(data.count);
      }
    } catch {
      // 失败回滚
      if (mounted.current) {
        setLiked(prevLiked);
        setCount(prevCount);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, liked, count, targetType, targetId]);

  const sizeCls = size === 'sm' ? 'gap-1 px-2 py-1 text-xs' : 'gap-1.5 px-3 py-1.5 text-sm';

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={liked}
      aria-label={liked ? '取消点赞' : '点赞'}
      className={`inline-flex items-center rounded-md border transition-colors duration-150 ${
        liked
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
      } ${sizeCls}`}
    >
      <Heart className={`size-4 ${liked ? 'fill-current' : ''}`} aria-hidden="true" />
      <span className="tabular-nums">{formatCount(count)}</span>
    </button>
  );
}
