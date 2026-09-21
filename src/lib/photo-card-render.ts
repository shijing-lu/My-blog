/**
 * 影集「管理列表」卡片渲染（服务端与客户端共用的同构纯函数）
 *
 * 为什么抽出来：`/gallery/upload` 的 URL 导入成功后原先 `window.location.reload()` 刷新列表。
 * 重载会：
 *   - 把「标签保留（批量导入常沿用同一批标签）」的意图抹掉 —— 标签输入框被一起重置，
 *     注释与行为自相矛盾；
 *   - 让刚写好的 `✓ 导入成功` 提示一闪即逝（用户永远看不到）；
 *   - 丢掉滚动位置。
 * 现在改为：客户端取回单张卡 HTML 就地插入。卡片标记必须与服务端首屏**完全一致**，
 * 故两边共用本模块（见 MEMORY.md「同一变换必须单一事实来源」）。
 *
 * ⚠️ 不得 import db / drizzle / Node 内置模块（会被打进客户端包）。
 */
import { esc } from './html-escape';

/** 管理卡片渲染所需的最小字段（服务端 `Photo` 与接口返回都满足） */
export interface ManageCardPhoto {
  id: string;
  url: string;
  thumbUrl?: string | null;
  title?: string;
  tags?: string[];
  /** 服务端是 `Date`、客户端是 ISO 串 */
  takenAt: Date | string;
}

/** 本地日期 `YYYY-MM-DD`（与 <input type="date"> 的 value 格式一致） */
export function photoDateKey(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 图片加载失败（R2 孤儿 / 防盗链）时就地摘掉该卡、同步计数与空态。
 * 原先是模板里的内联 onerror；抽到模块里以便服务端与客户端产物一致。
 */
const IMG_ONERROR =
  "var c=this.closest('.manage-card');if(!c||c.dataset.fallback)return;c.dataset.fallback='1';c.remove();" +
  "var n=document.getElementById('manage-photo-count');if(n)n.textContent=String(document.querySelectorAll('.manage-card').length);" +
  "var e=document.getElementById('manage-empty'),r=document.querySelectorAll('.manage-card').length;" +
  "r===0?(document.querySelectorAll('[data-manage-area]').forEach(function(a){a.classList.add('hidden')}),e&&e.classList.remove('hidden')):e&&e.classList.add('hidden')";

/** 单张管理卡片（标记与首屏 SSR 完全一致，客户端插入的卡与服务端渲染的卡无差别） */
export function renderManageCard(p: ManageCardPhoto): string {
  const title = p.title ?? '';
  const tags = (p.tags ?? []).join(',');
  const inputCls =
    'w-full rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus-visible:border-ring';
  return (
    `<div class="manage-card p-1" data-photo-id="${esc(p.id)}">` +
    `<div class="relative">` +
    `<img src="${esc(p.thumbUrl ?? p.url)}" alt="${esc(title || '照片')}" class="aspect-video w-full rounded object-cover" loading="lazy" data-broken-photo="${esc(p.id)}" onerror="${IMG_ONERROR}" />` +
    `<input type="checkbox" value="${esc(p.id)}" data-photo-check class="absolute left-1.5 top-1.5 size-4 cursor-pointer accent-[var(--color-primary)]" aria-label="选择这张照片" />` +
    `</div>` +
    `<input type="date" value="${esc(photoDateKey(p.takenAt))}" data-manage-date class="mt-2 ${inputCls}" aria-label="照片日期" />` +
    `<input type="text" value="${esc(title)}" data-manage-title maxlength="200" placeholder="标题" class="mt-1 ${inputCls}" aria-label="照片标题" />` +
    `<input type="text" value="${esc(tags)}" data-manage-tags maxlength="200" placeholder="标签（逗号分隔）" class="mt-1 ${inputCls}" aria-label="照片标签" />` +
    `<div class="mt-2 flex gap-2">` +
    `<button type="button" data-save-photo="${esc(p.id)}" class="flex-1 rounded border border-border px-2 py-1 text-xs transition-colors duration-200 hover:border-primary hover:text-primary">保存</button>` +
    `<button type="button" data-delete-photo="${esc(p.id)}" class="flex-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive transition-colors duration-200 hover:bg-destructive/10">删除</button>` +
    `</div>` +
    `</div>`
  );
}

/** 批量渲染（首屏 SSR 与客户端补卡共用） */
export function renderManageCards(list: ManageCardPhoto[]): string {
  return list.map(renderManageCard).join('');
}
