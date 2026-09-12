# 归档时间线（Archive Timeline）设计文档

> 日期：2026-09-12 · 状态：已实施（用户确认：改造归档页为时间线形态、按年月分组、封面条件渲染、右栏复用既有时间线组件、新增阅读量统计）

## 1. 背景与目标

为 My-Blog 增加**归档页 `/archive`**，以**时间线**形式倒序呈现全部文章。

- **用途**：给访客一条「按时间纵览全部文章」的浏览路径。首页是「最新 + 搜索/筛选」的即时入口，归档页则是**历史全景**——适合回看某个时期写了什么、按月份盘点产出。
- **形态**：左侧一条连续竖轴 + 节点圆点；年份大标题（`● 2026  57 篇`）→ 月份子标题（`9 月  3`）→ 文章卡片。卡片横排：左为「日号 + 中文星期」，中为「标题 + 元信息 + 摘要」，右为**可选**封面缩略图。
- **视觉风格**：与站点既有设计完全一致（主题令牌、像素字体、亮暗模式、View Transitions、`pixel-divider` / `pixel-chip` 语汇）。
- **导航入口**：顶部主导航新增「归档」（置于「动态」之后）。

### 与既有两条「时间线」的区别（易混淆，先厘清）

| | 位置 | 用途 |
| --- | --- | --- |
| `src/components/Timeline.astro` | **侧栏**（影集 / 动态 / **归档** 页的右栏） | 年/月或按天的**跳转导航**，点击定位或筛选 |
| **归档页 `.archive-*`**（本文档） | **页面主体**（左栏） | 真正的**内容展示**：文章按年月分组的时间线 |
| 影集/动态的分组头 | 页面主体 | 它们的正文是瀑布流/卡片流，时间线在侧栏 |

两者刻意共用「竖线 + 圆点 + 像素字标签」的视觉语汇，让侧栏导航与正文时间线看起来是同一套设计体系。

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

- 布局：两栏 `lg:grid-cols-[minmax(0,1fr)_170px]`（与 `/moments` 同构）。
  - 左栏：页面标题（`ARCHIVE` 眉标 + `归档` + 总篇数）+ `.archive-timeline` 主体。
  - 右栏：`<aside class="hidden lg:block"><div class="sticky top-20">`，内含既有 `Timeline.astro`（标题 `时间线 / TIMELINE`）。
- 导航入口：`src/layouts/BaseLayout.astro` 的主导航 `<a href="/archive">归档</a>`，class 与相邻链接逐字一致。

## 5. 数据层

### 5.1 `src/lib/article-timeline.ts`（纯函数，可单测）

```ts
interface TimelineEntry { meta: ArticleMeta; contentLength: number; year; month; day; weekday; }
interface TimelineMonth { month: number; count: number; entries: TimelineEntry[]; }
interface TimelineYear  { year: number;  count: number; months: TimelineMonth[]; }
interface TimelineNavItem { date: string; label: string; count: number; }

bjDateParts(d: Date): { y; mo; d; weekday }   // 北京时间；weekday 0=周日
weekdayLabel(weekday: number): string          // 0→周日 … 6→周六；越界→''
formatWordCount(n: number): string             // 5646→'5.6k'；397→'397'
buildArticleTimeline(metas): TimelineYear[]    // 按 createdAt 倒序 + 年→月分组
timelineNavItems(years): TimelineNavItem[]     // key: 'y-2026' / 'm-2026-9'
yearAnchorId(year) / monthAnchorId(year, month) // 锚点 id，与 nav key 同源
```

锚点 id 与导航 key 共用 `yearAnchorId` / `monthAnchorId` 生成，避免两处手写漂移（有单测断言一致性）。

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

`src/styles/global.css` 的 `@layer components` 内、既有 `.timeline*` 区块之后，新增 `.archive-*` 系列（带中文注释头）。

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

复用既有 `Timeline.astro`（其 `active` 类此前从未被调用方使用，本次启用）：

- **点击导航项 → 平滑滚动定位**：`data-timeline-date` 即锚点 id（`y-2026` / `m-2026-9`），`getElementById(key).scrollIntoView({behavior:'smooth'})`，并给该项加 `.active`。
- **反向高亮**：`IntersectionObserver`（`rootMargin: '-10% 0px -80% 0px'`）监听各年/月分组，滚到哪个分组就点亮对应导航项。收窄判定带是为了避免长列表里多个分组同时命中、高亮来回跳。
- **事件委托 + 幂等守卫**：`document` 级委托（View Transitions 换页后仍有效），`window.__archiveTimelineBound` 保证监听只绑一次。
- **只在归档页生效**：处理器会先确认页面存在 `.archive-timeline`，避免误接管影集/动态页的同类 `.timeline`。

与影集/动态的差异：那两页是「滚动定位到已加载分组（需逐页拉取）」或「按日期过滤（写 URL）」；归档页数据一次性全量渲染，故是**纯锚点跳转 + 双向高亮**。

## 9. 测试与验证

**单测** `tests/article-timeline.test.ts`（13 例）：
- 北京时间跨日/跨月边界（UTC 晚间 → 北京次日；UTC 月末 → 北京次月首日）
- `weekdayLabel` 全映射与越界回退
- `formatWordCount` 千位阈值
- `buildArticleTimeline` 空输入、乱序输入仍倒序、年/月分组与倒序、count 一致、`contentLength` 保留
- `timelineNavItems` 的 key 格式与锚点 id 一致性

**命令序列**：
```bash
pnpm vitest run                     # 302 通过（基线 289 + 新增 13）
pnpm exec astro check               # 0 errors / 0 warnings
node .diag/astro-syntax-check.mjs   # 58 个 .astro，0 失败
```

**端到端验证（本次已实测）**：`/archive` 返回 200；渲染出 2 年 / 3 月 / 9 篇；
5 篇有封面、其余无（确认条件渲染）；导航 key 与锚点 id 逐一对应；
日号+星期正确（`10 周四` / `01 周二` / `23 周日`）；字数 `1.1k 字` / `12.4k 字`；
`POST /api/views` 写入成功且归档页计数由 `0 阅读` 变为 `1 阅读`；
非法输入分别返回「缺少文章 ID」/「请求格式错误」；GET 返回 404。

## 10. 明确决策与预留

- ✅ **已确认**：改造归档页为时间线形态；按年月分组、新→旧；封面条件渲染；右栏复用既有组件；新增阅读量统计。
- ✅ **有意选择**：阅读量**不做去重**（每次访问 +1）；排序用 `createdAt` 而非 `updatedAt`；时间口径为北京时间。
- **预留**：归档页分页（当前全量渲染，文章量很大时可加）；阅读量改日去重或聚合计数器；`article_views` 的清理/归档策略；分类徽章按分类自带 `color` 上色（当前统一主色）。
