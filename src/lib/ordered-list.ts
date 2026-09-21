/**
 * 有序列表工具（服务端与客户端共用的纯函数）
 *
 * 后端多处用 `ORDER BY sort, createdAt` 输出列表。管理端做「就地更新、不整页刷新」时，
 * 必须把新记录插到**与服务端一致**的位置，否则原地重绘的顺序会和刷新后不一致
 * （用户会看到条目在刷新后莫名跳位）。
 *
 * 本模块把这段逻辑集中一处，供 `admin-nav-render.ts`（后台导航管理）与
 * `doc.astro`（文档库）等复用。
 */

/** 排序键：与后端 `ORDER BY sort ASC, createdAt ASC` 对应 */
export interface Sortable {
  sort: number;
  /**
   * 服务端渲染时是 `Date`，经 JSON 序列化传给客户端后是 ISO 字符串；
   * 两种形态都要能比较，见 `toTime`。
   */
  createdAt: string | Date;
}

/** createdAt 归一化：`Date` 或 ISO 字符串 → 毫秒时间戳（无法解析时按 0，即排最前） */
export function toTime(v: string | Date | undefined | null): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
}

/** 与服务端 `ORDER BY sort ASC, createdAt ASC` 等价的「a 是否应排在 b 之前」 */
export function comesBefore(a: Sortable, b: Sortable): boolean {
  if (a.sort !== b.sort) return a.sort < b.sort;
  return toTime(a.createdAt) < toTime(b.createdAt);
}

/**
 * 把 item 插到它在服务端顺序里应在的位置（`sort` 升序，同 sort 按 `createdAt` 升序）。
 *
 * 为什么能精确对齐：
 * - **新建**：新记录 `createdAt` 最大 → 落在同 sort 组末尾，与服务端一致；
 * - **编辑 / 移动分组**：先 `removeById` 再 `insertOrdered`，`createdAt` 未变 → 位置与服务端一致；
 * - 只移动被操作的那一项，其余元素相对顺序不动。
 */
export function insertOrdered<T extends Sortable>(list: T[], item: T): void {
  let at = list.length;
  for (let i = 0; i < list.length; i += 1) {
    if (comesBefore(item, list[i]!)) {
      at = i;
      break;
    }
  }
  list.splice(at, 0, item);
}

/** 从数组里移除指定 id 的元素，返回它（不存在则返回 undefined） */
export function removeById<T extends { id: string }>(list: T[], id: string): T | undefined {
  const at = list.findIndex((x) => x.id === id);
  if (at < 0) return undefined;
  return list.splice(at, 1)[0];
}
