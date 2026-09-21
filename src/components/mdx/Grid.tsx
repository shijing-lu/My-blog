/**
 * Grid 组件 —— `:::grid` 图片画廊网格
 *
 * MDX 源码：
 *   :::grid{columns="3" aspect="16/9" fit="cover"}
 *   ![图注](/img/a.webp)
 *   :::
 *
 * 设计要点：
 * - **只负责排版**：把容器内的图片排成等比例的响应式网格，不处理图片本身；
 * - **不向子组件注入任何上下文**：灯箱分组由脚本按「最近的 `.md-grid` 祖先」判定
 *   （见 src/scripts/lightbox.ts）。这样 `LightboxImage` 与 `Grid` 之间没有引用关系，
 *   避免组件间循环依赖（曾导致 dev 路由加载报 `Class extends value undefined`）；
 * - **参数二次校验**：源码层已做规范化与回退，这里再校验一次（组件也可能被直接写在
 *   MDX 里），任何非法值一律回退默认，绝不抛错（渲染铁律）。
 */
import type { CSSProperties, ReactNode } from 'react';

/** 列数校验：1~6 的整数，非法回退 3 */
function safeColumns(v: unknown): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 3;
}

/** 比例校验：`16/9`、`16:9`、`1/1` 均接受，非法回退 16/10 */
function safeAspect(v: unknown): string {
  const m = /^(\d{1,3})\s*[/:]\s*(\d{1,3})$/.exec(String(v ?? '').trim());
  if (!m) return '16/10';
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? `${a}/${b}` : '16/10';
}

/** 适应模式校验：只接受 cover / contain，非法回退 cover */
function safeFit(v: unknown): 'cover' | 'contain' {
  return String(v ?? '').trim().toLowerCase() === 'contain' ? 'contain' : 'cover';
}

/** Grid 组件 Props（由 mdx-plugins 的 remarkDirectiveToJsx 注入） */
interface GridProps {
  columns?: string;
  aspect?: string;
  fit?: string;
  children?: ReactNode;
}

/** 图片画廊网格容器 */
export default function Grid({ columns, aspect, fit, children }: GridProps): ReactNode {
  const cols = safeColumns(columns);

  const style = {
    '--md-grid-cols': String(cols),
    // 平板端最多两列（columns=1 时仍保持单列）
    '--md-grid-cols-sm': String(Math.min(cols, 2)),
    '--md-grid-aspect': safeAspect(aspect),
    '--md-grid-fit': safeFit(fit),
  } as CSSProperties;

  return (
    <div className="md-grid" style={style} data-md-grid>
      {children}
    </div>
  );
}
