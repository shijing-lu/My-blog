/**
 * 演示数据脚本（pnpm db:seed）
 *
 * 插入 tech / note / photo 三篇演示文章（幂等：slug 已存在则跳过），
 * 覆盖 GFM 表格、admonition 指令、代码块、列表、引用、内嵌 SVG 图片等 MDX 特性，
 * 供 Phase 2+ 的详情页/布局切换验收使用。
 */
import { randomUUID } from 'node:crypto';
import { getArticleBySlug, saveDraft } from '../src/lib/articles';
import type { ArticleUpsertInput } from './types';

/** 生成内嵌 SVG 占位图 data URI（无需外网，离线可渲染） */
function svgPlaceholder(width: number, height: number, from: string, to: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.9)" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const sunset = svgPlaceholder(1200, 700, '#2b3a67', '#c94b4b', '洱海 · 黄昏');
const notebook = svgPlaceholder(1200, 700, '#355070', '#6d597a', '学习笔记 · 手账');

/** 三篇演示文章（不含 id，seed 时生成） */
const DEMO_ARTICLES: ReadonlyArray<Omit<ArticleUpsertInput, 'id'>> = [
  {
    title: 'Astro 入门：从零搭建你的第一个交互岛',
    slug: 'astro-intro-first-island',
    type: 'tech',
    summary: '用 30 分钟理解 Astro 的岛架构：什么是 MPA、为什么静态优先、React 组件如何作为岛挂载。',
    tags: ['astro', 'web开发', '教程'],
    content: `# Astro 入门：从零搭建你的第一个交互岛

Astro 的核心思想是 **「静态优先，按需交互」**：默认输出零 JS 的 HTML，只有显式标记的组件才会作为"岛"发送到浏览器。

:::tip
岛架构（Islands Architecture）下，页面 = 静态 HTML + 若干独立交互岛，彼此不共享运行时。
:::

## 创建一个 React 岛

\`\`\`tsx
// src/components/Counter.tsx
import { useState } from 'react';

/** 计数器示例：作为 client:load 岛挂载 */
export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      点击了 {count} 次
    </button>
  );
}
\`\`\`

在页面里使用：

\`\`\`astro
---
import Counter from '@/components/Counter.tsx';
---
<Counter client:load />
\`\`\`

## 为什么这很重要

| 方案 | 首屏 JS | 交互粒度 |
| --- | --- | --- |
| 全站 SPA | 大 | 全部 |
| 静态 HTML | 0 | 无 |
| Astro 岛 | 按需 | 单组件 |

:::warning
不要为了一个按钮把整个路由变成 SPA——岛之外的内容应该保持纯静态输出。
:::

> 一句话总结：**能静态就不动态，要动态就只动那一小块。**`,
  },
  {
    title: 'Vim 高频命令速查（学习笔记）',
    slug: 'vim-cheatsheet-notes',
    type: 'note',
    summary: '整理日常写代码最高频的 Vim 操作：移动、编辑、多光标、寄存器与宏，附一张记忆卡片。',
    tags: ['vim', '效率', '笔记'],
    content: `# Vim 高频命令速查

> 本文是个人学习笔记，按"高频优先"排序，先记**能救命**的命令，再谈花活。

## 移动（最常用）

- \`w\` / \`b\` —— 按词前进 / 后退
- \`^ \` / \`$\` —— 行首 / 行尾
- \`gg\` / \`G\` —— 文件首 / 文件尾
- \`Ctrl-d\` / \`Ctrl-u\` —— 半屏下翻 / 上翻

## 编辑

1. \`ciw\` —— 删除当前词并进入插入模式（change inner word）
2. \`yy\` + \`p\` —— 复制当前行并粘贴
3. \`dd\` —— 删除当前行（后悔了按 \`u\`）

:::note
\`u\`（撤销）和 \`Ctrl-r\`（重做）一定要先记住——它们能救回 99% 的误操作。
:::

## 记忆卡片

- **操作 = 数字 + 动词 + 范围**：例如 \`3dw\` = 删除 3 个词。
- **动词**：\`d\` 删除、\`c\` 修改、\`y\` 复制、\`v\` 选中。
- **范围**：\`w\` 词、\`l\` 字符、\`$\` 行尾、\`}\` 段落。`,
  },
  {
    title: '洱海边的黄昏（摄影随笔）',
    slug: 'erhai-sunset-photo',
    type: 'photo',
    summary: '一次环湖骑行记录：光线、风与延时摄影的一点体会。',
    tags: ['摄影', '随笔', '旅行'],
    content: `# 洱海边的黄昏

黄昏的光线是一天里最慷慨的：色温下降，阴影拉长，水面把天空切成两半。

![洱海黄昏全景](PLACEHOLDER_SUNSET)

## 关于拍摄

骑行到海西的观景台时，太阳刚好落到苍山背后。我用 24mm 拍了这张全景——**前景的芦苇**是构图的锚点，**水面反光**负责引导视线。

:::note
延时摄影的黄金参数：间隔 2s，光圈 f/8，ISO 100，白平衡锁定日光。
:::

- 风大的日子记得上三脚架配重钩；
- 偏振镜能压掉水面反光，让云的倒影更通透；
- 后期只动色温与高光，别拉太多锐化。

![手账本上的速写](PLACEHOLDER_NOTEBOOK)

> 摄影的本质不是记录画面，而是**保存当时的心情**。`,
  },
];

/**
 * 主流程：幂等写入演示数据
 */
async function main(): Promise<void> {
  let created = 0;
  for (const demo of DEMO_ARTICLES) {
    const existing = await getArticleBySlug(demo.slug as string);
    if (existing) continue;
    const content = demo.content
      .replace('PLACEHOLDER_SUNSET', sunset)
      .replace('PLACEHOLDER_NOTEBOOK', notebook);
    await saveDraft({ id: randomUUID(), ...demo, content } as ArticleUpsertInput);
    created += 1;
  }
  console.log(`[seed] 完成：新增 ${created} 篇演示文章（已存在则跳过）。`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[seed] 失败：', err);
    process.exit(1);
  });
