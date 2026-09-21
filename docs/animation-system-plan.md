# My-Blog 动效系统计划书

> 覆盖范围：访客端 + 管理端 + **桌面端（优先）**。目标不是"到处加动画"，而是建立一套**有令牌、有编排、可降级、可验收**的动效层，把现在的"零散硬编码"升级为"系统"。
> 版本：v1 ｜ 2026-09-15

---

## 一、现状调研结论

### 1.1 技术底座

| 项 | 现状 |
|---|---|
| 框架 | Astro 7（server 输出）+ React 19 岛 + Tailwind v4 |
| 路由过渡 | **已在用** Astro `ClientRouter`（`BaseLayout.astro:32,136`，`fallback="swap"`）；`transition:persist` 4 处；`AdminLayout` **未接入**（后台整页刷新） |
| 动画库 | **GSAP 3.15**（唯一，`lib/anim.ts:15-24` 动态 import）+ `tw-animate-css` |
| 主题切换 | `ThemeToggle` → `lib/theme.ts` → `applyState()` 写 `data-theme` / `.dark` / `data-mode`，**纯瞬变无过渡** |
| reduced-motion | 已处理 7 处；**未覆盖**：`dialog-in`、`copy-shake`、`cal-tip-in`、`mind-anchor-flash`、`hero-char-*`、`ghost-drift`、tw-animate 的 `animate-in/out` |

### 1.2 已有动效资产（可直接复用，不要另起一套）

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 按钮涟漪/流星/烟花 | `global.css:170-276`、`BaseLayout.astro:494-495` | 作为"点击反馈"底层，新动效统一走同一委托入口 |
| 页面查询进度条 / 转圈遮罩 | `global.css:376-453` | 全局导航反馈基准 |
| 滚动进场 `.revealed` + GSAP ScrollTrigger | `BaseLayout.astro:333-343,410-422` | 抽象为统一 reveal 工具 |
| 阅读进度条 | `global.css:282-294` | 保留 |
| 诗词逐字 / Hero 轮播 | `HeroQuote.astro:119-143`、`index.astro:516-528` | 首页签名动效，保留 |
| 主题/滚动/复制/锚点等零散 keyframes | `global.css` 12 处 | 逐步归并到令牌 |

### 1.3 缺口清单（本计划要解决的）

1. **无令牌系统**：时长硬编码 0.1~0.9s 共 11 种、缓动混用 5 种 → 观感不统一；
2. **主题切换瞬变**：无过渡，是用户点名的"标杆效果"要改造的对象；
3. **无"以控件为中心"的空间过渡**：整屏一起变，缺少方向感与连续性；
4. **无共享元素（shared element）**：列表→详情、缩略图→大图都是硬切；
5. **反馈层缺失**：**无 Toast**、无表单错误抖动、无上传进度条、保存成功仅改文本；
6. **状态过渡缺失**：灯箱进出场、`<details>` 展开、目录高亮位移、侧栏折叠都不成体系；
7. **桌面端零动效**：同步状态只有托盘文本 + 原生弹窗；启动有白屏闪现；
8. **reduced-motion 未全覆盖**（见 1.1）。

---

## 二、技术选型评估

### 2.1 候选方案对比（2026 年现状）

| 方案 | 能力定位 | 体积 | 支持度 | 与项目契合度 | 结论 |
|---|---|---|---|---|---|
| **CSS 过渡 / 关键帧 / WAAPI** | 悬停、淡入、位移、骨架 | 0 KB | 全支持 | 项目已大量使用（Tailwind） | ✅ **主力**（覆盖约 70%） |
| **View Transitions API** | 页面跳转、状态变更、**共享元素变形**、圆形扩散 | 0 KB | 同文档：Chrome111+/Safari18+/FF133+（≈92%）；跨文档：Chrome126+/Safari18.2+/FF 需开关 | 项目**已用** ClientRouter（同一 API），主题切换链路单一出口 | ✅ **编排层**（标杆效果靠它） |
| **GSAP 3.15** | 时间线编排、ScrollTrigger、精确控制 | ~23 KB | 全支持 | **已安装**，已有 hero/heatmap 用法 | ✅ **特型**（滚动叙事、复杂序列） |
| **CSS 滚动驱动动画** `animation-timeline: view()` | 滚动进场、视差，**零 JS** | 0 KB | Chrome115+/Safari18+（部分）；FF 需开关 | 可替代现有 IntersectionObserver 的一半场景 | ✅ **增强** + `@supports` 回退 |
| **Motion（原 Framer Motion）** | React 声明式进出场/布局/手势 | ~32 KB | 全支持 | 项目 React 岛少（编辑器/评论/点赞），收益小 | ⚠️ **暂不引入**（见 2.3） |
| React Spring / Anime.js | 弹簧/轻量补间 | 18 KB / 小 | 全支持 | 与上一个同问题 | ❌ 不引入（社区维护风险，2026 年被列入避免清单） |

### 2.2 推荐组合（三层，各司其职）

```
层 1  令牌 + CSS/WAAPI         ← 覆盖 70%：悬停、按压、淡入、骨架、错误抖动
层 2  View Transitions API     ← 编排：页面跳转、状态切换、共享元素、主题圆形扩散
层 3  GSAP                     ← 特型：滚动叙事、时间线、需要逐帧控制的地方
```

**为什么不引入 Motion**：① 项目是 Astro 岛架构，绝大多数动效发生在**原生 DOM/CSS 层**而非 React 树内，Motion 的价值（声明式进出场、layout FLIP）只覆盖少数几个岛；② 32 KB 的体积需要"动效本身就是产品"才划算（如营销站），本项目是内容型；③ 项目已有 GSAP 与 ClientRouter，引入第三套会产生"谁是主导"的维护成本。**若后续列表增删场景暴增**，可用 ~3 KB 的 `@formkit/auto-animate` 或直接用 View Transitions 解决，仍不必上 Motion。

### 2.3 降级与兼容策略

| 能力 | 降级路径 |
|---|---|
| View Transitions 不支持（约 8% 会话，主要是老 Firefox） | 直接执行 DOM 变更（`if (!document.startViewTransition)`），观感退化为瞬变，**功能不受影响** |
| 滚动驱动动画不支持 | `@supports (animation-timeline: view())` 包住，回退到现有 IntersectionObserver `.revealed` |
| `prefers-reduced-motion: reduce` | ① 令牌层统一压制：位移/缩放归零、时长→90ms 或 0；② `::view-transition-*` 自定义动画必须显式 `animation: none`；③ 不做"必须等动画结束才能操作"的交互 |

---

## 三、动效令牌（设计系统基线）

> 现状：无令牌。**第一阶段先立令牌**，之后所有动效只允许引用令牌，禁止硬编码时长。

```css
/* src/styles/tokens-motion.css（新增，由 global.css 引入） */
:root {
  /* 时长：以"交互反馈快、内容入场慢"为原则 */
  --dur-instant: 90ms;    /* 按压、勾选、开关 */
  --dur-fast: 160ms;      /* 悬停、聚焦、图标旋转 */
  --dur-base: 240ms;      /* 卡片入场、Tab 切换、抽屉 */
  --dur-slow: 360ms;      /* 页面元素编排、灯箱 */
  --dur-slower: 560ms;    /* 主题扩散、Hero 级签名动效 */

  /* 缓动：soft 系列统一观感，spring 只用于"有物理感"的反馈 */
  --ease-out-soft: cubic-bezier(.22,.61,.36,1);
  --ease-in-out-soft: cubic-bezier(.4,0,.2,1);
  --ease-spring: cubic-bezier(.34,1.56,.64,1);
  --ease-snap: cubic-bezier(.2,.9,.1,1);

  /* 位移：统一距离语言，避免 3px/7px/13px 这类随意值 */
  --dist-1: 4px;  --dist-2: 8px;  --dist-3: 16px;  --dist-4: 28px;

  /* 错位：列表 stagger 间隔 */
  --stagger-1: 40ms; --stagger-2: 70ms;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-instant: 0ms; --dur-fast: 0ms; --dur-base: 0ms;
    --dur-slow: 0ms; --dur-slower: 0ms;
    --dist-1: 0px; --dist-2: 0px; --dist-3: 0px; --dist-4: 0px;
    --stagger-1: 0ms; --stagger-2: 0ms;
  }
}
```

**性能与体验原则**

1. 只动 `transform` / `opacity` / `filter`（必要时 `clip-path`）；**不动** `top/left/width/height` 做动画（除侧栏宽度这类必须的，且加 `will-change` 后移除）；
2. 单次交互反馈 ≤ 160ms，单个元素入场 ≤ 360ms，整页编排 ≤ 700ms；
3. 动画不阻塞交互：任何时候点击都要立刻响应（禁止"等动画"才能操作）；
4. 不制造 CLS：入场动画从最终位置附近开始（`--dist-2` 级），不做大幅位移；
5. 桌面端优先：桌面无网络延迟，可略长（240~560ms）；移动端只保留 `--dur-fast` 级；
6. 焦点可见性优先于动效（`:focus-visible` 样式不参与动画）。

---

## 四、分区域动效清单

> 优先级：**P0** 标杆与关键路径 ｜ **P1** 高频交互 ｜ **P2** 锦上添花
> 实现代号：`CSS`=层1 ｜ `VT`=View Transitions ｜ `GSAP`=层3 ｜ `SCROLL`=滚动驱动

### A. 全局与页面级

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| A1 | 页面跳转（访客页） | 方向感知交叉位移 + 共享元素 | old 左移淡出 / new 右移淡入，`--dur-slow` | `VT`（沿用 ClientRouter，补 `::view-transition-*` 与 `transition:name`） | P0 |
| A2 | **主题切换** | **以按钮为中心的圆形扩散** | `--dur-slower` + `--ease-in-out-soft` | `VT` + `clip-path: circle()` | **P0（标杆）** |
| A3 | 页面加载指示 | 顶条不确定进度 → 收束消失 | `--dur-base` | `CSS`（升级现有 `nav-progress`） | P1 |
| A4 | 滚动进场 | 上移淡入（统一令牌 + stagger） | `--dur-slow` / `--stagger-2` | `SCROLL` + IntersectionObserver 回退 | P1 |
| A5 | 阅读进度条 | 已有 `scaleX` 线性 | 保留 | `CSS` | 保持 |
| A6 | 首屏加载 | 骨架 → 内容淡入（避免跳动） | `--dur-base` | `CSS` | P1 |

### B. 导航与框架

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| B1 | 右侧工具栏展开 | 图标错位弹出 + 背景模糊渐显 | `--dur-base` / `--stagger-1` | `CSS` | P1 |
| B2 | 移动端菜单/抽屉 | 遮罩淡入 + 面板位移 + 内容错位 | `--dur-base` | `CSS` | P1 |
| B3 | 文档左右侧栏折叠 | 宽度/位移过渡 + 图标旋转 90° | `--dur-base` | `CSS`（升级现有 `0.2s`） | P1 |
| B4 | 设置页 Tab 切换 | 面板交叉淡化 + 指示条滑动 | `--dur-base` | `VT` + `CSS` | P1 |
| B5 | 后台页面切换 | 目前整页刷新（无过渡）→ 轻量淡入 | `--dur-base` | `CSS`（不引入 ClientRouter，避免后台状态丢失） | P2 |
| B6 | 侧边导航激活项 | 背景块滑移（FLIP 或伪元素平移） | `--dur-fast` | `CSS` | P2 |

### C. 列表与卡片

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| C1 | 文章/文档/影集卡片入场 | 上移淡入 + stagger（仅视口内） | `--dur-slow` / `--stagger-2` | `SCROLL` 优先 | P1 |
| C2 | 动态发布新卡片 | 新项从表单处"落下" + 高亮一次 | `--dur-slow` | `VT`（对 `moments/cards.astro` 局部刷新包裹） | P0 |
| C3 | 评论提交 | 乐观插入 + 高亮入场 | `--dur-base` | `VT`/`CSS` | P0 |
| C4 | 待办勾选 | 勾选描边动画 + 文字划线 + 列表重排 | `--dur-base` | `CSS` + FLIP（少量项） | P1 |
| C5 | 文档树展开/收起 | 高度过渡 + 箭头旋转（替代 `details` 瞬变） | `--dur-base` | `CSS` | P1 |
| C6 | 筛选/标签切换（归档、标签页） | 结果交叉淡化 | `--dur-base` | `VT` | P1 |
| C7 | 分页切换 | 内容交叉位移 | `--dur-base` | `VT` | P2 |
| C8 | 瀑布流图片加载 | 骨架 → 淡入 + 轻微缩放（1.02→1） | `--dur-slow` | `CSS` | P1 |

### D. 表单与编辑器

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| D1 | 输入聚焦 | 边框主色过渡 + 标签浮动 | `--dur-fast` | `CSS` | P1 |
| D2 | 校验错误 | 横向抖动 2 次 + 红边 + 自动滚动到首错 | `--dur-base` | `CSS`（复用 `copy-shake` 思路） | P1 |
| D3 | 保存成功 | **Toast 滑入** + 按钮内勾选描边 | `--dur-base` | `CSS`（新建轻量 Toast 层） | P0 |
| D4 | 上传进度 | 进度条 + 完成态脉冲一次 | 按实际进度 | `CSS` | P1 |
| D5 | 危险操作确认 | 现有 `dialog-in` → 统一令牌 + 遮罩模糊 | `--dur-fast` | `CSS` | P1 |
| D6 | Markdown 编辑器预览切换 | 分栏/单栏宽度过渡 | `--dur-base` | `CSS` | P2 |

### E. 内容渲染

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| E1 | 图片灯箱打开/关闭 | **共享元素变形**：缩略图 → 大图 | `--dur-slow` | `VT`（`view-transition-name` 由 key 派生） | **P0** |
| E2 | 目录滚动高亮 | 指示器平滑位移（非仅颜色） | `--dur-fast` | `CSS` | P1 |
| E3 | `<details>`/折叠面板 | 高度过渡 + 箭头旋转 | `--dur-base` | `CSS` | P1 |
| E4 | 锚点跳转 | 已有 `mind-anchor-flash` → 统一令牌 | 2s 递减 | `CSS` | 保持 |
| E5 | 代码复制反馈 | 已有高亮 + shake → 统一；成功改勾选图标 | `--dur-fast` | `CSS` | P1 |
| E6 | 公式/表格/引用块入场 | 仅在长文中首次进入视口时淡入 | `--dur-base` | `SCROLL` | P2 |
| E7 | Tabs / Callout 展开 | 内容高度 + 淡入 | `--dur-base` | `CSS` | P2 |

### F. 交互反馈

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| F1 | 点赞 | 心形弹跳 + 一圈粒子（复用现有粒子委托） | `--dur-base` | `CSS` | P1 |
| F2 | 按钮悬停/按压 | 统一 lift（`translateY(-1px)`）+ `scale(0.97)` | `--dur-instant` | `CSS` | P0（全局基线） |
| F3 | 空状态 | 图标轻浮动 + 文案淡入 | `--dur-slow` | `CSS` | P2 |
| F4 | 加载骨架 | 统一 shimmer（替换 `animate-pulse`） | 1.4s 循环 | `CSS` | P1 |

### G. 桌面端专属（本计划重点）

| # | 位置/触发 | 动效类型 | 参数 | 实现 | 优先级 |
|---|---|---|---|---|---|
| G1 | 应用启动 | 窗口显示后主内容上浮淡入（消除白屏闪现） | `--dur-slow` | `CSS`（`html[data-desktop]` 作用域） | **P0** |
| G2 | 同步状态变化 | 状态 chip 交叉切换 + 进行中进度条 + 完成脉冲 | `--dur-base` | `CSS`（设置页同步分区） | P0 |
| G3 | 同步进度逐表推进 | 列表项逐个点亮 | `--dur-fast` / `--stagger-1` | `CSS` | P1 |
| G4 | 离线/在线切换 | 顶部条滑入 + 图标状态过渡 | `--dur-base` | `CSS` | P1 |
| G5 | 图片按需下载完成 | 缩略图模糊占位 → 清晰（`filter: blur` 过渡） | `--dur-slow` | `CSS` | P1 |
| G6 | 托盘同步中 | 托盘图标无动画 API → 用 tooltip 文本 + 完成后系统通知 | — | Electron | P2 |

---

## 五、标杆效果：主题切换的圆形扩散（P0）

**目标**：亮/暗切换不再整屏瞬变，而是**以用户点击的按钮为圆心向外扩散**，暗→亮、亮→暗都自然。

**落点选择**：`lib/theme.ts:54-61` 的 `applyState()` 是主题落到 DOM 的**唯一出口** → 在这里包一层 `startViewTransition` 即可覆盖"快捷按钮"与"设置面板"两条路径，无需改各调用点。

**实现要点**

```ts
/** 统一的 View Transition 包装（无支持则直接执行） */
export async function withViewTransition(update: () => void, opts?: { origin?: { x: number; y: number } }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) {
    update();
    return;
  }
  // 记录扩散原点（按钮中心或点击坐标），并用最大半径保证覆盖全屏
  const x = opts?.origin?.x ?? innerWidth / 2;
  const y = opts?.origin?.y ?? innerHeight / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.style.setProperty('--vt-x', `${x}px`);
  document.documentElement.style.setProperty('--vt-y', `${y}px`);
  document.documentElement.style.setProperty('--vt-r', `${r}px`);
  const t = document.startViewTransition(update);
  await t.finished;
}
```

```css
/* 新层做圆形扩散，旧层保持不动（形成"揭幕"观感） */
::view-transition-old(root) { animation: none; }
::view-transition-new(root) {
  animation: vt-circle var(--dur-slower) var(--ease-in-out-soft) both;
}
@keyframes vt-circle {
  from { clip-path: circle(0px at var(--vt-x) var(--vt-y)); }
  to   { clip-path: circle(var(--vt-r) at var(--vt-x) var(--vt-y)); }
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; }
}
```

**必须处理的细节**

1. **坐标来源**：鼠标点击取 `e.clientX/e.clientY`；**键盘触发**（Enter/Space）取按钮 `getBoundingClientRect()` 中心；程序化调用（`mode='system'` 跟随系统）取屏幕中心；
2. **与 Astro ClientRouter 共存**：页面跳转期间不重复触发主题过渡（`if (document.documentElement.dataset.vtActive)` 简易互斥），避免嵌套 VT 抛错；
3. **持久元素排除**：header/footer/侧栏已用 `transition:persist` → 给它们加 `view-transition-name: none`，避免被扩散快照重复渲染；
4. **暗→亮与亮→暗的观感差异**：暗色下扩散边缘对比更强，必要时暗→亮用 `--ease-out-soft` 并略缩短（`--dur-slow`），亮→暗保持 `--dur-slower`；
5. **系统主题变化**：顺带补上 `matchMedia('(prefers-color-scheme: dark)')` 的 change 监听（现状缺失），`mode='system'` 时实时响应且同样走扩散。

---

## 六、落地路线（四阶段）

| 阶段 | 内容 | 主要产出 | 验收 |
|---|---|---|---|
| **S1 地基** | 令牌文件、`withViewTransition` 工具、reduced-motion 全量补齐（含 tw-animate 与 7 处遗漏）、统一 reveal 工具（SCROLL + IO 回退） | `tokens-motion.css`、`lib/motion.ts` | 令牌覆盖率 100%（全局无硬编码时长残留）；reduced-motion 全站生效 |
| **S2 标杆与关键路径** | A2 主题扩散、A1 页面跳转编排、E1 灯箱共享元素、C2/C3 列表增删（动态/评论） | 上述 4 项 + 关键路径回归 | 圆形扩散在亮/暗两向、鼠标/键盘两路径均正常；灯箱开关无跳变 |
| **S3 全面覆盖** | B/C/D/E/F 组的 P1 项（导航、表单反馈、Toast、卡片 stagger、代码/折叠/目录等） | 覆盖 ≥ 30 个交互节点 | 逐项走查清单通过；无新增 CLS |
| **S4 桌面端专属与收尾** | G1~G5、性能与可访问性验收、文档、**桌面端重建** | 桌面端包 + 动效说明 | 桌面端启动无白屏；同步状态可视；`vitest` 全绿、`astro check` 0 error、桌面构建冒烟 200 |

**每阶段收尾固定动作**：`astro check`（0 error）→ `vitest`（当前 370 用例全绿）→ 桌面端 `build:desktop` 重建 → 启动冒烟（`BYQX_SMOKE` 200）。

---

## 七、验收标准

**性能**：单次交互反馈 ≤ 160ms 内可感知；入场动画不掉帧（桌面端目标 60fps）；不引入 CLS（入场位移 ≤ `--dist-3` 且从最终位置附近开始）。

**可访问性**：`prefers-reduced-motion: reduce` 下所有位移/缩放/扩散被压制（不是"变快"）；键盘全可达且焦点可见；任何动画都不作为功能完成的前置条件。

**体验一致性**：全站时长/缓动/位移只出现令牌值；同一类交互（悬停、按压、入场）观感统一。

**回归**：`vitest` 全绿、`astro check` 0 error、桌面端可启动且同步正常。

---

## 八、风险与"不做"清单

| 风险 | 对策 |
|---|---|
| View Transitions 与 ClientRouter 嵌套/重复触发 | 单一入口 `withViewTransition` + 运行中互斥标记 |
| `view-transition-name` 重名导致报错 | 由数据 id 派生；持久元素显式 `none` |
| 滚动驱动动画兼容性 | `@supports` 包裹 + IntersectionObserver 回退（保留现有实现） |
| 动画残留（观察者/内联样式未清理） | 统一在 `astro:page-load` 重建、`astro:before-swap` 清理；新增动效必须写清理分支 |
| 大列表 FLIP 成本 | 只对首屏/小块做；长列表用 VT 或直接淡入 |

**不做**：不引入 Motion / React Spring / Anime.js（体积与一致性权衡，见 §2.2）；不做全站粒子化；不对长列表做逐项 FLIP；不用动画掩盖加载慢（该修加载就修加载）。

---

## 附：本计划涉及的新增/改动文件

**新增**：`src/styles/tokens-motion.css`、`src/lib/motion.ts`（`withViewTransition` + reveal 工具）、`docs/动效走查清单.md`（S3 产出）

**改动**：`src/styles/global.css`（令牌引用化 + VT 伪元素规则 + 遗漏项 reduced-motion）、`src/lib/theme.ts`（扩散包装 + 系统主题监听）、`scripts/lightbox.ts`（共享元素）、`src/components/*`（卡片/表单/反馈/工具栏等）、`desktop/main.cjs` 与设置页同步分区（G1/G2）、`astro.config.mjs`（如需配置 `viewTransitions`）
