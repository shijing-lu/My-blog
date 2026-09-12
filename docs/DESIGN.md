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

## 4. 归档页采用时间线形态

- **`/archive` 不另开页面、不做卡片列表**：归档页直接做成「时间线」形态（年 / 月大标题 → 左侧连续竖轴 + 节点圆点 → 右侧文章卡片）。
- **右栏由「年 / 月时间线导航」改为「标签 + 分类筛选面板」**（`ArticleFilterPanel.astro`）：点击即**当前页内即时过滤**，无请求无刷新。原时间线导航是「定位」类功能（跳过即可），而筛选是「功能」类，故窄屏也必须在正文流内可达 —— 用 `<details>` 折叠面板兜住（桌面侧栏 `hidden lg:block`，窄屏 `<details class="... lg:hidden">`，同一组件渲染两份，脚本用 `querySelectorAll` 同步两边按钮态）。
  - 标签与分类**互斥**（点一方清另一方）：两维度叠加会让「筛出 0 篇」难以理解，且两组按钮同时高亮不易读。
  - **筛选必须联动隐藏被筛空的年 / 月分组**：只隐藏文章卡会留下「9 月 / 0」的孤零零标题，视觉破碎。先算月份（组内是否还有可见卡片）、再算年份（年内是否还有可见月份）。
  - 筛选匹配的 key 口径统一为**小写**（`tagKeys()` 写 `data-tags`、`aggregateTags()` 产按钮 key），展示名保留原始大小写（`JavaScript` 而非 `javascript`）。
  - 计数为 0 的分类**照常渲染但 `disabled`**（置灰）：它是写作台里真实存在的分类，隐藏会让人以为分类丢了。
- **时间顺序按 `createdAt`（发布时间）倒序**，分组前先按发布时间重排，避免「后补旧文」导致组内乱序；年 / 月标题均按**北京时间**（`Asia/Shanghai`）切分，星期标签 `周日…周六` 由 `Intl.DateTimeFormat` 的 `en-US` short 名映射得到。
- **封面条件渲染**：卡片封面可选 —— 有封面则显示右侧缩略图（`?w=600&f=webp`），无封面则整块省略（不占位、不留白）。
- **阅读量统计（`article_views` 表）**：口径为「**每次访问 +1，不做去重**」（与 `likes` 的指纹去重不同），用于时间线卡片展示「N 阅读」。为避开 View Transitions 预取造成的误计数，采用**客户端上报**（`POST /api/views`，`keepalive`，同会话同文章去重），并加内存限流兜底。
- **卡片入场动画继承**：时间线卡片带 `.post-card` 类，自动继承 `BaseLayout` 的 `observeReveals()` 入场动画，无需另写脚本。

## 5. 既有约定（保持不变）

- 技术栈：Astro 7（server）+ React 岛 + Tailwind v4 + shadcn + Drizzle（SQLite/PG）+ MDX evaluate + 自建评论（`comments`/`likes` 表，原 Giscus 已移除）。
- 公开页零重 JS；微交互仅 CSS hover；View Transitions 用 `<ClientRouter />`。
- git 提交遵循 Conventional Commits。
