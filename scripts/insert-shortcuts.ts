/**
 * 插入/更新「Markdown 编辑器快捷键速查」文章（幂等）
 * 用法：pnpm exec tsx scripts/insert-shortcuts.ts
 */
import { randomUUID } from 'node:crypto';
import { getArticleBySlug, saveDraft } from '../src/lib/articles';

const SLUG = 'markdown-editor-shortcuts';
const TITLE = 'Markdown 编辑器快捷键速查';
const TYPE = 'note';
const SUMMARY = '本站写作台（Obsidian 式所见即所得编辑器）的常用 Markdown 快捷键：格式化、标题、行操作与内置导航。';
const TAGS = ['markdown', '快捷键', '效率'];

const CONTENT = `# Markdown 编辑器快捷键速查

本站写作台使用 **CodeMirror 6** 的所见即所得（Live Preview）编辑体验。以下为常用快捷键，覆盖**格式化、标题、行操作与导航**。

:::tip
\`Ctrl/Cmd\` 表示 Windows/Linux 用 \`Ctrl\`、macOS 用 \`Cmd\`。以下快捷键均在**编辑器区域内**生效。
:::

## 一、格式化
选中文本后按快捷键即包裹对应语法；不选中时插入一对标记、光标停在中间。

| 快捷键 | 效果 | 示例 |
| --- | --- | --- |
| Ctrl/Cmd + B | **加粗** | \`**文本**\` |
| Ctrl/Cmd + I | *斜体* | \`*文本*\` |
| Ctrl/Cmd + E | \`行内代码\` | \`\` \`文本\` \`\` |
| Ctrl/Cmd + K | [链接](https://example.com) | \`[文本](url)\` |
| Ctrl/Cmd + Shift + X | ~~删除线~~ | \`~~文本~~\` |

## 二、标题

| 快捷键 | 效果 |
| --- | --- |
| Ctrl/Cmd + Alt + H | 循环：正文 → H1 → H2 → H3 → 正文 |
| Ctrl/Cmd + Alt + 1~6 | 设为第 1~6 级标题（重复按同键取消） |
| Ctrl/Cmd + Alt + 0 | 清除标题（恢复正文） |

## 三、行操作

| 快捷键 | 效果 |
| --- | --- |
| Alt + ↑ / ↓ | 上移 / 下移当前行 |
| Shift + Alt + ↑ / ↓ | 向上 / 向下复制当前行 |
| Ctrl/Cmd + D | 删除当前行 |
| Tab / Shift + Tab | 缩进 / 反缩进 |

## 四、导航与编辑

| 快捷键 | 效果 |
| --- | --- |
| Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z | 撤销 / 重做 |
| Ctrl/Cmd + F / Enter | 查找 / 下一个匹配 |
| Ctrl/Cmd + ← / → | 按词左右移动 |
| Ctrl/Cmd + A | 全选 |
| Ctrl/Cmd + S | 手动保存（输入时亦每 500ms 防抖自动保存） |
| Home / End / PageUp / PageDown | 行首 / 行尾 / 上翻页 / 下翻页 |

## 五、小技巧

- 选中多行后 \`Ctrl/Cmd + Alt + H\` 可统一设为标题。
- 光标停在行内任意位置按 \`Ctrl/Cmd + Alt + 1\`，整行变一级标题；再按一次恢复正文。
- 无选区时按 \`Ctrl/Cmd + B\` 会插入 \`****\` 并把光标放在中间——直接打字即得 \`**内容**\`。

> 本文由本站写作台编写：先用快捷键插入标题、表格与指令，右侧实时渲染验证。
`;

async function main(): Promise<void> {
  const existing = await getArticleBySlug(SLUG);
  if (existing) {
    await saveDraft({ id: existing.id, title: TITLE, type: TYPE, summary: SUMMARY, tags: TAGS, content: CONTENT, slug: SLUG });
    console.log('[insert-shortcuts] 已更新既有文章:', SLUG);
  } else {
    await saveDraft({ id: randomUUID(), title: TITLE, type: TYPE, summary: SUMMARY, tags: TAGS, content: CONTENT, slug: SLUG });
    console.log('[insert-shortcuts] 已创建文章:', SLUG);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[insert-shortcuts] 失败：', err);
    process.exit(1);
  });
