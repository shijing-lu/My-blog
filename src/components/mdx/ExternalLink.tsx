/**
 * ExternalLink 组件 —— 链接映射
 *
 * 外链（http/https）自动新窗口 + rel 安全属性；站内锚点/相对链接保持原样。
 */
import type { ComponentProps, ReactNode } from 'react';

/** 渲染一个链接（外链新窗口） */
export default function ExternalLink({ href, children, ...props }: ComponentProps<'a'>): ReactNode {
  const external = typeof href === 'string' && /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...props}
    >
      {children}
    </a>
  );
}
