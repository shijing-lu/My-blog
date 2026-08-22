/**
 * 分页纯函数（与数据库/UI 解耦，便于单测）
 */

/** 分页上下文 */
export interface PageInfo {
  /** 当前页（1 起） */
  page: number;
  /** 总页数（至少 1） */
  totalPages: number;
  /** 是否有上一页 */
  hasPrev: boolean;
  /** 是否有下一页 */
  hasNext: boolean;
  /** 首页条目标引（0 起，供 offset 计算） */
  offset: number;
}

/** 解析页号：非法/越界值收敛到 [1, totalPages] */
export function clampPage(raw: unknown, totalPages: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '1'));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, Math.floor(n)), Math.max(1, totalPages));
}

/** 计算分页元信息 */
export function pageInfo(page: number, total: number, pageSize: number): PageInfo {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = clampPage(page, totalPages);
  return {
    page: p,
    totalPages,
    hasPrev: p > 1,
    hasNext: p < totalPages,
    offset: (p - 1) * pageSize,
  };
}

/** 生成页码序列（总页数少则全列，多则省略号折叠） */
export function pageWindow(page: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const around = [page - 1, page, page + 1].filter((n) => n >= 1 && n <= totalPages);
  const set = new Set<number>([1, ...around, totalPages]);
  const sorted = [...set].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}
