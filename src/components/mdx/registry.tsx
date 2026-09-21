/**
 * MDX 组件注册表
 *
 * 将自定义组件映射到 MDX 元素：
 * - `Admonition`：`:::note` 指令生成的 JSX 组件
 * - `Callout`：`> [!note]` Obsidian 风格引用块（remarkCallout 生成，支持 `-` 折叠）
 * - `Collapse` / `CollapsePanel`：`:::collapse` 折叠面板组与单个面板
 * - `Tabs` / `Tab`：`:::tabs#id` 选项卡组与单个选项卡（同 stableId 跨组联动）
 * - `Grid`：`:::grid` 图片画廊网格（等比例网格 + 容器内独立灯箱分组）
 * - `pre` → `Pre`：代码块包装（折叠/展开 + 复制按钮）
 * - `code` → `InlineCode`：**行内**代码包装（悬停右上角一键复制）；代码块内的 `code`
 *   经 `CodeBlockContext` 判定后只渲染裸 `<code>`，按钮仍由 `Pre` 提供（避免重复）
 * - `img` → `LightboxImage`：图片灯箱包装
 * - `a` → `ExternalLink`：外链新窗口
 *
 * 注：荧光高亮 `==文本==` 由 rehypeMark 直接产出 hast `<mark>` 元素，
 * 不经过 React 组件注册表（见 src/lib/mdx-plugins.ts 的设计说明）。
 */
import type { ComponentType } from 'react';
import Admonition from './Admonition';
import Callout from './Callout';
import Collapse, { CollapsePanel } from './Collapse';
import Tabs, { Tab } from './Tabs';
import Grid from './Grid';
import Spoiler from './Spoiler';
import Pre from './Pre';
import InlineCode from './InlineCode';
import LightboxImage from './LightboxImage';
import ExternalLink from './ExternalLink';

/** 组件映射类型 */
export type MDXComponentMap = Record<string, ComponentType<Record<string, unknown>>>;

/** 默认组件注册表 */
export const mdxComponents: MDXComponentMap = {
  Admonition,
  Callout,
  Collapse,
  CollapsePanel,
  Tabs,
  Tab,
  Grid,
  Spoiler,
  pre: Pre,
  code: InlineCode,
  img: LightboxImage,
  a: ExternalLink,
};
