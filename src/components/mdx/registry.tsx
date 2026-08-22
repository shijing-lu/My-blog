/**
 * MDX 组件注册表
 *
 * 将自定义组件映射到 MDX 元素：
 * - `Admonition`：`:::note` 指令生成的 JSX 组件
 * - `pre` → `Pre`：代码块包装（复制按钮）
 * - `img` → `LightboxImage`：图片灯箱包装
 * - `a` → `ExternalLink`：外链新窗口
 */
import type { ComponentType } from 'react';
import Admonition from './Admonition';
import Pre from './Pre';
import LightboxImage from './LightboxImage';
import ExternalLink from './ExternalLink';

/** 组件映射类型 */
export type MDXComponentMap = Record<string, ComponentType<Record<string, unknown>>>;

/** 默认组件注册表 */
export const mdxComponents: MDXComponentMap = {
  Admonition,
  pre: Pre,
  img: LightboxImage,
  a: ExternalLink,
};
