/**
 * MDX 组件注册表
 *
 * 将自定义组件映射到 MDX 元素：
 * - `Admonition`：`:::note` 指令生成的 JSX 组件
 * - `Callout`：`> [!note]` Obsidian 风格引用块（remarkCallout 生成，支持 `-` 折叠）
 * - `pre` → `Pre`：代码块包装（复制按钮）
 * - `img` → `LightboxImage`：图片灯箱包装
 * - `a` → `ExternalLink`：外链新窗口
 *
 * 注：荧光高亮 `==文本==` 由 rehypeMark 直接产出 hast `<mark>` 元素，
 * 不经过 React 组件注册表（见 src/lib/mdx-plugins.ts 的设计说明）。
 */
import type { ComponentType } from 'react';
import Admonition from './Admonition';
import Callout from './Callout';
import Pre from './Pre';
import LightboxImage from './LightboxImage';
import ExternalLink from './ExternalLink';

/** 组件映射类型 */
export type MDXComponentMap = Record<string, ComponentType<Record<string, unknown>>>;

/** 默认组件注册表 */
export const mdxComponents: MDXComponentMap = {
  Admonition,
  Callout,
  pre: Pre,
  img: LightboxImage,
  a: ExternalLink,
};
