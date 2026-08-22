# 设计决策记录（DESIGN）

> 本文档记录历次 UI/交互决策，避免回归。

## 1. 视觉语言

- **像素风格**：除「文章本体」外，**所有 UI 文字一律使用像素字体**（`--font-pixel-family`，Silkscreen）。
  - 文章本体（`.prose` 正文）使用可读的正文字体（`--font-sans-family`），其标题使用衬线（`--font-display-family`）。
  - 主题可通过把 `fontPixel` 设为 sans/mono 调整像素浓度（如「极简奶油」= 无像素）。
- **Hero「记录 · 思考 · 光影」带残影**：使用 `.ghost-text`（层叠 text-shadow + 缓慢漂移动画，颜色取自主题主色）。
- 主题系统：编译期 TS 插件 + 运行时 JSON 导入（见 docs/THEME-DEV.md）。

## 2. 导航与角色

- **首页导航栏右上角**：
  - 未登录 → 「登录」入口（→ /login）。
  - 已登录（管理员角色）→ 「写作」入口（→ /edit/new）。
- **角色模型**：访客（只读公开页） vs 管理员（会话 Cookie，口令或 GitHub OAuth）。无多角色。

## 3. 写作入口与编辑体验

- **不做专门的「后台新建文章」页**：
  - 新建入口 = **右侧边栏「房子（首页）图标下方」的 + 按钮**（仅管理员可见）→ `/edit/new`。
  - 首页文章卡片右上角（管理员可见）有「编辑」按钮 → `/edit/[id]`。
- **编辑页 = Obsidian 式所见即所得（单栏，不分栏）**：
  - CodeMirror 6 Live Preview 架构：隐藏 Markdown 语法标记 + 代码块/引用/表格/指令/图片渲染为块级组件，光标所在块回到源码态。
  - 500ms 防抖自动保存 `/api/save-draft`；Ctrl/Cmd-S 手动保存；`beforeunload` 提醒；401 提示重新登录。
  - `/admin` 仅作文章管理列表（编辑/删除入口），不再承载分栏编辑器。

## 4. 既有约定（保持不变）

- 技术栈：Astro 7（server）+ React 岛 + Tailwind v4 + shadcn + Drizzle（SQLite/PG）+ MDX evaluate + Giscus。
- 公开页零重 JS；微交互仅 CSS hover；View Transitions 用 `<ClientRouter />`。
- git 提交遵循 Conventional Commits。
