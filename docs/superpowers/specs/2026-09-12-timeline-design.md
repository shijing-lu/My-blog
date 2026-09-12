# 归档时间线（Archive Timeline）设计文档

> 日期：2026-09-12 · 状态：已实施（用户确认：改造归档页为时间线形态、按年月分组、封面条件渲染、新增阅读量统计；后续按用户要求将右栏由「年/月时间线导航」改为「标签 + 分类筛选面板」）

## 1. 背景与目标

为 My-Blog 增加**归档页 `/archive`**，以**时间线**形式倒序呈现全部文章。

- **用途**：给访客一条「按时间纵览全部文章」的浏览路径。首页是「最新 + 搜索/筛选」的即时入口，归档页则是**历史全景**——适合回看某个时期写了什么、按月份盘点产出。
- **形态**：左侧一条连续竖轴 + 节点圆点；年份大标题（`● 2026  57 篇`）→ 月份子标题（`9 月  3`）→ 文章卡片。卡片横排：左为「日号 + 中文星期」，中为「标题 + 元信息 + 摘要」，右为**可选**封面缩略图。
- **视觉风格**：与站点既有设计完全一致（主题令牌、像素字体、亮暗模式、View Transitions、`pixel-divider` / `pixel-chip` 语汇）。
- **导航入口**：顶部主导航新增「归档」（置于「动态」之后）。

### 与既有两条「时间线」的区别（易混淆，先厘清）

| | 位置 | 用途 |
| --- | --- | --- |
| `src/components/Timeline.astro` | **侧栏**（影集 / 动态页的右栏） | 年/月或按天的**跳转导航**，点击定位或筛选 |
| `src/components/ArticleFilterPanel.astro` | **侧栏**（**归档**页的右栏） | 标签 / 分类**筛选**（即时过滤，非跳转） |
| **归档页 `.archive-*`**（本文档） | **页面主体**（左栏） | 真正的**内容展示**：文章按年月分组的时间线 |
| 影集/动态的分组头 | 页面主体 | 它们的正文是瀑布流/卡片流，时间线在侧栏 |

归档页的右栏曾复用 `Timeline.astro` 做年/月跳转，后按用户要求改为「标签 + 分类筛选面板」（见 §8）。视觉上仍共用「竖线 + 圆点 + 像素字标签」这套语汇，但归档侧栏已不再渲染时间线元素。

## 2. 展示的数据与事件

时间线展示的「事件」= **一篇文章的发布**。每条卡片呈现：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| 标题 | `articles.title` | 空则显示「未命名」 |
| 分类徽章 | `article_categories` + `article_post_categories` | 无归属则不渲染徽章 |
| 字数 | SQL `length(content)`（`listArticlePageMeta` 的 `contentLength`） | 千位以上显示 `x.xk 字`；**不取回正文** |
| **阅读量** | `article_views` 表聚合（本次新增，见 §6） | 显示 `N 阅读` |
| 日期 / 星期 | `createdAt` → 北京时间年月日 + 中文星期 | 卡片左侧大号日号 + `周三` 等 |
| 摘要 | `articles.summary` | 两行截断（`line-clamp: 2`） |
| 封面 | `articles.cover`（**仅手动封面**） | 有则显示右侧缩略图；**无则整块不渲染** |
| 加密标记 | `articles.encrypted` | 为真时追加「已加密」小字 |

**为什么封面只用 `cover` 而不回落正文首图**：列表查询刻意不取正文（性能，见 §3），
而正文首图提取需要正文内容。首页 Hero 也有同样取舍（见 `src/pages/index.astro` 注释）。

## 3. 时间顺序与分组

- **分组**：`年 → 月` 两级。年份标题带该年总篇数，月份标题带该月篇数。
- **排序键 = `createdAt`（发布时间）**，不是 `updatedAt`。
  - 归档的语义是「什么时候发的」；`updatedAt` 会被任何一次编辑顶到最前，把旧文重新插进归档顶部，破坏时间线的历史感。
  - ⚠️ `listArticlePageMeta()` 默认按 `updatedAt` 倒序返回，故 `buildArticleTimeline()` 内部**重新排序**，不依赖入参顺序。
- **时间口径 = 北京时间（`Asia/Shanghai`）**。Vercel 实例跑在 UTC，直接用 `Date#getFullYear` 等本地 getter，会把东八区凌晨（00:00–08:00）发布的文章归到前一天甚至前一月。故与 `src/lib/moments.ts` 采用同一 `Intl.DateTimeFormat` 方案（在 `article-timeline.ts` 内独立实现，不导出对方的私有函数，降低耦耦）。
- **排序实现**：全量按 `createdAt` 倒序后，用 `Map` 依次登记年、组内 `find` 月份——Map 的插入序天然是时间倒序，年月都不需要二次排序。

## 4. 页面与路由

| 路由 | 类型 | 说明 |
| --- | --- | --- |
| `/archive` | 公开 | 归档时间线；一次全量渲染，无分页 |

- 布局：两栏 `lg:grid-cols-[minmax(0,1fr)_230px]`（与 `/moments` 同构，右栏加宽以容纳分类两列卡片）。
  - 左栏：页面标题（`ARCHIVE` 眉标 + `归档` + 总篇数）+ 筛选状态条 + `.archive-timeline` 主体 + 空结果提示。
  - 右栏：`<aside class="hidden lg:block"><div class="sticky top-20">`，内含 `ArticleFilterPanel.astro`（标签 / TAGS + 分类 / CATEGORIES）。
  - 窄屏补充：筛选是「功能」而非「导航」，`hidden lg:block` 会让手机端完全用不了，故左栏另有 `<details class="archive-filter-mobile lg:hidden">` 渲染同一组件兜底。
- 导航入口：`src/layouts/BaseLayout.astro` 的主导航 `<a href="/archive">归档</a>`，class 与相邻链接逐字一致。

## 5. 数据层

### 5.1 `src/lib/article-timeline.ts`（纯函数，可单测）

```ts
interface TimelineEntry { meta: ArticleMeta; contentLength: number; year; month; day; weekday; }
interface TimelineMonth { month: number; count: number; entries: TimelineEntry[]; }
interface TimelineYear  { year: number;  count: number; months: TimelineMonth[]; }
interface TimelineNavItem { date: string; label: string; count: number; }
interface FilterFacet { key: string; label: string; count: number; }

bjDateParts(d: Date): { y; mo; d; weekday }   // 北京时间；weekday 0=周日
weekdayLabel(weekday: number): string          // 0→周日 … 6→周六；越界→''
formatWordCount(n: number): string             // 5646→'5.6k'；397→'397'
buildArticleTimeline(metas): TimelineYear[]    // 按 createdAt 倒序 + 年→月分组
timelineNavItems(years): TimelineNavItem[]     // key: 'y-2026' / 'm-2026-9'（侧栏导航已不用，函数保留）
yearAnchorId(year) / monthAnchorId(year, month) // 锚点 id，与 nav key 同源

// —— 侧栏筛选面板聚合（本次新增）——
aggregateTags(metas): FilterFacet[]              // 标签→篇数；篇数倒序、同数按拼音名称升序
aggregateCategories(categories, catMap): FilterFacet[] // 分类→篇数；count=0 的条目保留（页面置灰）
tagKeys(tags): string[]                          // 写 data-tags 的归一 key（小写去重）
```

锚点 id 与导航 key 共用 `yearAnchorId` / `monthAnchorId` 生成，避免两处手写漂移（有单测断言一致性）。

**筛选 key 的一致性契约（关键）**：`aggregateTags()` 产出的 `key` 与 `tagKeys()` 写进 `data-tags` 的值必须同口径（均小写），否则按钮点了筛不出东西。两者都有单测，且 E2E 实测做了双向校验（按钮 key 集合 ↔ 卡片 tag 集合并集完全相等，每个标签的计数与卡片实际命中数逐一相符）。

**空值语义**：`aggregateCategories` 对「文章中无归属」不虚构「未分类」项 —— 侧栏是筛选器而非统计报表。`map` 里指向已删除分类的孤儿 id 被忽略。

### 5.2 页面取数（分段并行）

```ts
const [metas, categories, catMap] = await Promise.all([
  listArticlePageMeta(1, ALL),   // 全量 + contentLength（不取正文）
  listArticleCategories(),
  articleCategoryMap(),
]);
const viewMap = await countViewsByTargets(metas.map((m) => m.id)); // 依赖 metas，故第二段
```

与首页 P1-1 的分段并行同思路：无依赖的并行取，有依赖的单独取。

## 6. 阅读量统计（本次新增）

### 6.1 表 `article_views`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | UUID |
| article_id | text NOT NULL | 文章 id |
| created_at | timestamp NOT NULL | 浏览时间 |

索引 `article_views_article_idx(article_id)`：服务单篇统计与归档页批量 `IN + GROUP BY`。

**刻意不做任何去重**（无身份字段、无唯一约束）——这是与 `likes` 表的**关键差异**，
也属**有意选择**：阅读量口径被明确设定为「**每次访问 +1**」，所以表就是一行一次访问的
流水，写入路径只有纯 INSERT。

### 6.2 数据流

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 上报锚点 | `src/pages/blog/[slug].astro` | `<span data-article-id={article.id} hidden>`，放在**锁定/解锁分支之外**（访问即算一次阅读） |
| 客户端打点 | `src/pages/blog/[slug].astro` 脚本 | `astro:page-load` 时 `fetch POST /api/views`，`keepalive: true`；SPA 会话内按 id 去重；失败静默 |
| 接口 | `src/pages/api/views.ts` | 仅 POST；校验 articleId 长度；内存限流（同 IP + 同文章，10 分钟 60 次）；超限返回 `{ok:false}` 而非 4xx（埋点失败不打扰访客） |
| 数据层 | `src/lib/article-views.ts` | `recordView` / `countViews` / `countViewsByTargets` / `listViews` |
| 迁移 | `scripts/migrate-article-views.mjs` | 构建期幂等 DDL，挂 `pnpm build` 链路（Vercel 环境变量 Sensitive，无法本地连库跑 DDL） |

### 6.3 已知代价与预留

- **无去重 → 刷新/重复访问会累加**，数值偏大。这是口径决定的，非缺陷。升级路径：改 `likes` 式指纹唯一约束，或加 `view_date` 列做「同人每天 1 次」。
- **表持续增长**，暂无清理策略。预留：按时间归档、或另存聚合计数器列。
- **预取污染**：已用「`astro:page-load` 打点 + SPA 会话内按 id 去重」缓解；若实测仍被 Astro prefetch 放大，退化为 `visibilitychange` 打点。

## 7. 视觉与风格

### 7.1 样式位置

`src/styles/global.css` 的 `@layer components` 内、既有 `.timeline*` 区块之后，新增 `.archive-*` 系列与 `.filter-*` 系列（均带中文注释头）。

### 7.2 类名层级

```
.archive-timeline            容器：position:relative; padding-left:1.75rem
  └ ::before                 连续竖轴（一根到底，跨月不断）
.archive-year                年分组（id=y-2026）
  ├ .archive-year-heading    年份标题（背景色遮断轴线）
  │   ├ .archive-year-dot    主色圆点（压在轴上）
  │   ├ .archive-year-num    年份（像素字）
  │   └ .archive-year-count  N 篇
  └ .archive-month           月分组（id=m-2026-9）
      ├ .archive-month-heading  月份（虚线底，沿用影集语汇）
      └ .archive-item
          ├ .archive-node       轴上节点（hover 转主色）
          └ .archive-card .post-card
              ├ .archive-day       日号块（右 1px 分隔）
              ├ .archive-card-main 标题 / 元信息 / 摘要
              │   ├ .archive-chip        分类徽章（主色 14% 淡底）
              │   └ .archive-chip-meta   字数 / 阅读 / 已加密
              └ .archive-card-cover 封面（仅在有封面时渲染）

.filter-panel                侧栏筛选容器（flex column, gap 1.5rem）
  ├ .filter-heading          区块标题（主色小方块 + 像素字）
  ├ .filter-tags / .filter-tag[.active] / .filter-tag-count
  ├ .filter-categories / .filter-category[.active] / .filter-category-name / .filter-category-count
  └ .filter-empty            空态（无标签 / 无分类）
.archive-filter-bar[.hidden] 已选条件提示条（脚本控显隐）
  ├ .archive-filter-label / #archive-filter-name / #archive-filter-count
  └ .archive-filter-clear    「清除」按钮
.archive-filter-mobile       窄屏折叠面板（<details>，lg 以上隐藏）
  └ .archive-filter-mobile-summary  自绘 `[+]` / `[-]` 指示（去掉引擎默认 marker）
```

### 7.3 关键视觉约定

- **轴连续性**：竖线画在**容器** `::before` 上（`top/bottom` 到底）而非每组分段，故跨月/跨年天然连续；年份标题用 `background: var(--color-background)` 遮断轴线一小段，得到「年份打断时间轴」的层级观感。
- **节点避线**：`.archive-node` 用 `box-shadow: 0 0 0 2px var(--color-background)` 描边把轴线「挖空」，避免线穿过圆点显得脏。
- **令牌复用，零新增颜色**：只用 `--color-border / primary / muted-foreground / background / foreground / muted / accent`、`--font-pixel-family / display`、`--radius-sm / md`。
- **卡片 hover 与入场动画**：卡片同时带 `.post-card`，因此 hover 上浮 + `shadow-md` 与滚动入场动画（BaseLayout 的 `observeReveals()` 选择器含 `.post-card`）**全部继承，无需重复定义、也无需改 BaseLayout**。
- **封面条件渲染**：`{cover && <div class="archive-card-cover">…}`——无封面时整块不渲染（非灰底占位），主体 `flex:1 1 auto` 自然铺满。
- **窄屏（≤640px）**：轴收窄到 1.1rem；封面移到卡片顶部通栏（`order:-1` + `aspect-ratio:16/9`），避免横排把主体挤成窄列。
- **锚点跳转**：年份/月份标题设 `scroll-margin-top: 5rem`，避开 sticky header（与首页 `#latest` 的 `scroll-mt-24` 同理）。

## 8. 交互

### 8.1 侧栏筛选（标签 / 分类，当前实现）

点击标签或分类 → **当前页内即时过滤**（无请求、无刷新），与首页 `applyTagFilter` 同一套约定（`data-*` 驱动 + `hidden` 类切换）。

- **标签与分类互斥**：点一方会清掉另一方。两维度同时生效会让「筛出 0 篇」的情况难以理解，且两组按钮同时高亮不易读。
- **再次点击同一项 = 取消筛选**（与首页标签行为一致）。
- **联动隐藏被筛空的年 / 月分组**（本页特有）：归档页按年月分组，若只隐藏文章卡，被筛空的分组会留下「9 月 / 0」的孤零零标题。顺序必须**先算月份**（组内是否还有可见卡片）、**再算年份**（年内是否还有可见月份）。
- **状态条**：`#archive-filter-bar` 显示 `#标签名` 或 `分类名` + 命中篇数，带「清除」按钮；`#archive-filter-empty` 在命中 0 篇时出现。
- **匹配 key 口径**：`data-tags` 与按钮 `data-filter-tag` 同为**小写**（`tagKeys()` / `aggregateTags()` 保证一致）；状态条展示名回读按钮文案，保留原始大小写。
- **两份面板同时同步**：桌面 `<aside>` 与窄屏 `<details>` 渲染同一组件，脚本用 `querySelectorAll` 刷新所有按钮态（`querySelector` 取文案即可，两份文案相同）。
- **事件委托 + 幂等守卫**：`document` 级委托（View Transitions 换页后仍有效），`window.__archiveFilterBound` 保证监听只绑一次；处理器先确认 `.archive-timeline` 存在，避免误接管其他页面。

### 8.2 年 / 月跳转（已移除）

侧栏原先复用 `Timeline.astro` 做「点击导航项 → 平滑滚动定位 + `IntersectionObserver` 反向高亮」（`window.__archiveTimelineBound`）。改为筛选面板后这套逻辑连同 `data-timeline-date` 点击处理一并删除；`Timeline.astro` 组件本身保留（影集 / 动态页仍在用），其 `.timeline*` 样式亦保留。

## 9. 测试与验证

**单测** `tests/article-timeline.test.ts`（26 例）：
- 北京时间跨日/跨月边界（UTC 晚间 → 北京次日；UTC 月末 → 北京次月首日）
- `weekdayLabel` 全映射与越界回退
- `formatWordCount` 千位阈值
- `buildArticleTimeline` 空输入、乱序输入仍倒序、年/月分组与倒序、count 一致、`contentLength` 保留
- `timelineNavItems` 的 key 格式与锚点 id 一致性
- **`aggregateTags`**：篇数倒序+同数名称升序、同篇内重复标签只计一次（防篇数虚高）、大小写归一到小写 key 但展示名保留首次写法、trim 去空、空输入、中文按拼音序
- **`aggregateCategories`**：篇数倒序、count=0 保留、无归属不虚构「未分类」、空分类表、孤儿 categoryId 被忽略
- **`tagKeys`**：小写去重、与 `aggregateTags` 的 key 可直接互比（筛选匹配的前提）、空输入

**命令序列**：
```bash
pnpm vitest run                     # 315 通过（289 基线 + 13 时间线 + 13 筛选聚合）
pnpm exec astro check               # 0 errors / 0 warnings / 13 hints（与基线一致）
node .diag/astro-syntax-check.mjs   # 59 个 .astro，0 失败
```

**端到端验证（本次已实测）**：`/archive` 返回 200；渲染出 2 年 / 3 月 / 9 篇；
5 篇有封面、其余无（确认条件渲染）；日号+星期正确（`10 周四` / `01 周二` / `23 周日`）；字数 `1.1k 字` / `12.4k 字`；
`POST /api/views` 写入成功且归档页计数由 `0 阅读` 变为 `1 阅读`；
非法输入分别返回「缺少文章 ID」/「请求格式错误」；GET 返回 404。

**筛选面板 E2E**（`.diag/archive-filter-e2e.mjs`，playwright-core + msedge 无头，24 项断言全过）：
初始态 4 项（全量可见 / 状态条隐藏 / 无高亮）；点标签 7 项（只留 3 篇命中、状态条 `#Markdown` `3 篇`、按钮高亮、**被筛空的月分组隐藏 1/2**、仍有分组可见）；
再点同标签取消 4 项；标签→分类互斥 4 项（标签高亮清除、分类高亮、状态条显示分类名无 `#` 前缀）；
清除按钮 4 项；另做**双向一致性校验**（6 个标签按钮 key ↔ 卡片 `data-tags` 并集完全相等，各标签计数与实际命中数逐一相符）。

**已知无关问题（非本次引入）**：本地 dev 下 R2 封面图会打印 CORS 报错（Astro 工具栏审计做跨域 fetch 所致）。已确认 ① 首页 `/` 同样复现，② R2 对象直连返回 HTTP 200 / 32426 字节，③ 裸 `<img>` 渲染不需要 CORS，故无实际影响，未处理。

## 10. 明确决策与预留

- ✅ **已确认**：改造归档页为时间线形态；按年月分组、新→旧；封面条件渲染；新增阅读量统计；**右栏由时间线导航改为标签 + 分类筛选（即时过滤）**。
- ✅ **有意选择**：阅读量**不做去重**（每次访问 +1）；排序用 `createdAt` 而非 `updatedAt`；时间口径为北京时间；标签与分类**互斥**（不叠加）；筛选 key 统一小写；count=0 分类置灰而非隐藏；筛选联动隐藏空年月分组。
- **预留**：归档页分页（当前全量渲染，文章量很大时可加）；阅读量改日去重或聚合计数器；`article_views` 的清理/归档策略；分类徽章按分类自带 `color` 上色（当前统一主色）；筛选条件写 URL（当前刷新即重置，不可分享筛选后的链接）。
