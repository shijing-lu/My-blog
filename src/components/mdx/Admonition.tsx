/**
 * Admonition 组件 —— `:::note/tip/warning/danger/info` 指令的渲染目标
 *
 * Props（由 remarkDirectiveToJsx 注入）:
 * - type: 指令名（note | tip | warning | danger | info）
 * - title: 可选自定义标题；缺省用类型默认文案
 * - children: 指令体内容
 */
import type { ReactNode } from 'react';

interface AdmonitionProps {
  type?: string;
  title?: string;
  children?: ReactNode;
}

/** 各类型的默认文案与图标 */
const META: Record<string, { label: string; icon: string }> = {
  note: { label: '备注', icon: 'i' },
  tip: { label: '提示', icon: '✦' },
  warning: { label: '注意', icon: '!' },
  danger: { label: '危险', icon: '⚠' },
  info: { label: '信息', icon: 'ℹ' },
};

/** 渲染一个 admonition 提示块 */
export default function Admonition({ type = 'note', title, children }: AdmonitionProps): ReactNode {
  const safeType = META[type] ? type : 'note';
  const meta = META[safeType] ?? { label: '备注', icon: 'i' };
  return (
    <aside className={`admonition admonition-${safeType}`} data-admonition={safeType} role="note">
      <div className="admonition-title">
        <span className="admonition-icon" aria-hidden="true">{meta.icon}</span>
        <span className="font-medium">{title ?? meta.label}</span>
      </div>
      <div className="admonition-body">{children}</div>
    </aside>
  );
}
