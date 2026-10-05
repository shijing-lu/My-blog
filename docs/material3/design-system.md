# Material 3 设计规范与实现契约

## 范围与切换

Material 使用 `html[data-ui-style='material3']` 作为唯一样式入口，明暗状态继续使用根节点 `.dark`。Astro 页面、React 组件、Radix portal 和动态插入的编辑器界面共享同一套令牌；切换只更新外观状态，不替换正文、编辑器实例或业务数据。现有风格不匹配这些规则，旧主题、字体、背景及外观 CSS 的配置仍保留。

样式入口为 `src/styles/material3.css`，按职责引入 `material3-tokens.css`、`material3-components.css`、`material3-content.css`、`material3-modules.css`。字体和图标在 `material3-resources.css`，自适应导航及全局工具在 `material3-navigation.css`。规则使用根节点作用域，避免只在页面容器内生效而漏掉 portal。

## 色彩

构建工具使用官方 `@material/material-color-utilities@0.4.0`，源色 `#1A73E8`，`SchemeTonalSpot`，标准对比度 `0`，分别生成明亮和暗色的 49 个角色。当前固定使用该版本默认的 Material 3 2021 色彩规则；源色用于生成色阶，组件的 `primary` 并非直接使用源色。角色与方案依据见 [官方 Tonal Spot 实现](https://github.com/material-foundation/material-color-utilities/blob/main/typescript/scheme/scheme_tonal_spot.ts) 和 [Material Dynamic Colors](https://github.com/material-foundation/material-color-utilities/blob/main/typescript/dynamiccolor/material_dynamic_colors.ts)。

| 角色 | 明亮 | 暗色 | 用途 |
| --- | --- | --- | --- |
| primary / on-primary | `#435E91` / `#FFFFFF` | `#ADC7FF` / `#0F2F60` | 主要操作和对应文字 |
| primary-container / on-primary-container | `#D8E2FF` / `#2A4678` | `#2A4678` / `#D8E2FF` | 主色容器、正文目录入口、助手 FAB |
| secondary-container / on-secondary-container | `#DBE2F9` / `#3F4759` | `#3F4759` / `#DBE2F9` | 导航选中、分段选择、次级操作 |
| tertiary-container / on-tertiary-container | `#FBD7FC` / `#583E5B` | `#583E5B` / `#FBD7FC` | 全局工具 FAB、辅助强调 |
| surface / on-surface | `#F9F9FF` / `#1A1B20` | `#111318` / `#E2E2E9` | 页面与正文 |
| surface-container-low | `#F3F3FA` | `#1A1B20` | 抽屉、卡片和文档树 |
| surface-container | `#EDEDF4` | `#1E1F25` | 菜单和嵌套容器 |
| surface-container-high | `#E8E7EE` | `#282A2F` | 弹窗、代码及较高层容器 |
| outline / outline-variant | `#74777F` / `#C4C6D0` | `#8E9099` / `#44474F` | 控件边界 / 分隔线 |
| error / on-error | `#BA1A1A` / `#FFFFFF` | `#FFB4AB` / `#690005` | 错误与破坏性操作 |
| inverse-surface / inverse-on-surface | `#2F3036` / `#F0F0F7` | `#E2E2E9` / `#2F3036` | Snackbar、Tooltip |

完整角色还包括 fixed、fixed-dim、surface-dim、surface-bright、五级 surface-container、error-container、inverse-primary、surface-tint、shadow 和 scrim。每个角色同时提供 `--m3-*` 与 `--md-sys-color-*`，后者引用前者。旧公共变量如 `--background`、`--primary`、`--border` 映射至对应角色，避免未重写的业务组件混用旧配色。

生成文件不手工改色。运行：

```powershell
rtk pnpm run material:tokens
rtk pnpm run material:tokens --check
```

脚本通过 `tsx` 运行；当前官方包存在部分无后缀模块导入，直接用 Node 执行 `.mjs` 会失败。色阶算法只在构建时运行，浏览器不携带色彩生成引擎。

对实际生成的 11 对文字/背景角色分别检查明暗模式，共 22 项。最小对比度为明亮 6.45:1、暗色 7.20:1；正文 `on-surface / surface` 为 16.39:1 和 14.41:1。结果在 `outputs/material3-review/palette-audit.json`。这项验证针对固定角色配对，不等同于所有图片背景、透明叠加、用户创作图表及第三方 iframe 的对比度验收。

## 字体、图标与文字层级

界面字体依次为 `Roboto Variable`、`Noto Sans SC Variable`、系统中文无衬线。两套 Fontsource 依赖当前均为 `5.3.0`，CSS 和 WOFF2 随应用构建；中文字体按 unicode-range 分片，仅按页面文字请求对应分片。Material Symbols Rounded 使用本地子集 `public/fonts/material3/material-symbols-rounded.woff2`，文件为 18,484 字节，默认图标 24px。现有图标 DOM 保留，由风格选择显示 Material 图标或原图标。

界面提供完整 15 级尺寸/行高令牌；标准表对应 [官方 Material Web 字体令牌](https://github.com/material-components/material-web/blob/main/tokens/_md-sys-typescale.scss)。

| 层级 | Large 字号/行高 | Medium 字号/行高 | Small 字号/行高 |
| --- | --- | --- | --- |
| Display | 57 / 64 | 45 / 52 | 36 / 44 |
| Headline | 32 / 40 | 28 / 36 | 24 / 32 |
| Title | 22 / 28 | 16 / 24 | 14 / 20 |
| Body | 16 / 24 | 14 / 20 | 12 / 16 |
| Label | 14 / 20 | 12 / 16 | 11 / 16 |

单位均为 CSS px。界面默认 Body Medium 14/20，字距 .25px；按钮 Label Large 14/20，字重 500、字距 .1px；输入内容 16/24。中文长文使用 16px、1.8 行高的独立阅读节奏，正文标题仍支持六级层次。代码使用等宽字体，KaTeX 保留其专用字体与布局，不把公式替换为界面字体。

## 形状、层级与反馈

形状令牌依次为 4、8、12、16、28px 和全圆。按钮使用全圆；卡片通常 12/16px；输入框与菜单 4px；弹窗 28px；FAB 16px。页面和普通卡片采用容器色区分层级，菜单、浮层和 FAB 使用统一 elevation 1–5。

公共控件支持 filled、tonal、outlined、text、danger；Astro 原生控件、Radix `data-slot` 和 Cadence `data-m3-role` 使用同一角色配对。Hover 状态层为 8%，按下为 12%，键盘焦点使用 3px 主色轮廓，禁用透明度 .38，加载状态使用进度指针和现有加载反馈。状态层不改变业务事件或提交逻辑。Material 状态依据见 [交互状态规范](https://m3.material.io/foundations/interaction/states/overview)。

短/中/长动效为 150/300/400ms；标准曲线 `cubic-bezier(.2,0,0,1)`，强调曲线 `cubic-bezier(.05,.7,.1,1)`。减少动态效果时将时长归零并取消动画滚动。旧背景图片装饰、星尘、像素装饰和文字光晕在 Material 下停用；用户文章媒体及首页内容图片保留。

## 布局与阅读

主导航在 `<600px` 使用 80px 底栏并加安全区；600–839px 使用 80px 导航轨；≥840px 使用 240px 常驻抽屉。主内容宽度与导航占位共同计算，浮层避让底栏。首页图片容器采用桌面最小 360px、手机最小 280px，高度随长标题增加。

文档树和正文保留原组件与状态。`<1024px` 下文档树内容区限高 `min(280px,34dvh)` 并局部滚动，让选中文章正文更早出现；桌面继续使用列布局。热力图的月份标签与方格放在同一个局部横向滚动区。代码、公式、宽表格保持局部滚动，普通正文换行。

日程的全局工具 FAB 与模块助手 FAB 保留至少 12px 间距；助手面板打开时隐藏全局工具，关闭后恢复工具的展开状态。经典风格布局不使用这些规则。

## 触控目标与明确边界

应用界面采用至少 48 CSS px 的触控命中区，依据 [Android 无障碍触控尺寸建议](https://support.google.com/accessibility/android/answer/7101858?hl=en-GB)。桌面鼠标界面可以使用 32/40px 的紧凑视觉尺寸；`any-pointer: coarse` 提升触控目标，也覆盖同时连接鼠标的触屏电脑。

| 对象 | 视觉尺寸 | 触控命中区 / 处理 |
| --- | --- | --- |
| 常规按钮、图标按钮、筛选与分页、菜单项 | 桌面可 32/40px | 触控至少 48px，菜单行始终至少 48px |
| 原生设置 checkbox / radio | 20×20px | 透明伪元素扩大到 48×48px；带文字标签也提供行命中区 |
| 原生 switch | 52×32px | 52×48px 命中区，保留标准轨道形状 |
| Cadence checkbox | 20×20px 指示器 | 原生隐藏输入保留，外层 label 至少 48px |
| 正文标题折叠 / 编辑标题折叠 | 箭头 24px | 触控按钮及编辑 gutter 为 48px，正文预留 56px 左侧空间 |
| 编辑表格边缘操作 | 28×28px | 透明命中区扩大到 48×48px |
| 主导航 / 示例编辑图标 | 按布局分配 | 390px 实测约 76×80px / 50×50px |

正文任务列表输入、行内代码复制与 CodeMirror 行内折叠占位仍保留行内几何，避免透明命中区覆盖旁边可编辑文字。当前证据没有将这些行内控件计为 48px 已通过；后续若统一增大，需要同时调整行间距和文本选择交互。正文中的普通文字链接也沿用文字排版。这一边界必须与应用工具栏和设置控件的 48px 结果分开报告。

## 已执行的设计系统验证

2026-10-04 20:03（UTC+8）在隔离数据库的正式构建服务、Edge/Chromium 上运行设计审计，记录为 `outputs/material3-review/design-audit.json`：

- 阻断所有外部网络请求后，Roboto Variable、Noto Sans SC Variable、Material Symbols Rounded 均匹配到已加载字体；15 个字体请求全部为同源本地 URL 且返回 200。此项证明界面字体无需 Google CDN，不代表真实 Android 断网启动已验收。
- 正式构建的主色实际计算值为明亮 `#435e91`、暗色 `#adc7ff`；默认正文行高令牌为 `20px`。
- 触控模拟下，checkbox/radio 在 20px 视觉区域外实际点击后改变选中状态；switch 在 32px 轨道外点击也生效。主导航与示例编辑图标实测尺寸见上表。
- 首页、文档、日程、设置各生成两风格、明暗、390/1280px 共 32 张正式截图，所有样本无页面横向溢出、浏览器错误或设置写入。视觉发现与最后样式修正在 [视觉审阅记录](visual-review.md) 中单独列出。
- 色彩生成一致性检查通过；最后模块规则能被 PostCSS 解析且保持根节点作用域。源码审计不替代客户端安装、真机 WebView、编辑器状态及双数据库验证，相关结果由总验收记录汇总。

初始 32 张截图发生在最后的模块触控覆盖、日程 FAB 避让及手机文档树限高修正前。2026-10-05 00:38（UTC+8）已在包含最后 CSS/manifest 的实际构建上追加运行态复核，证据为 `outputs/material3-review/final-design-check.json`：

- 手机 390px 和触屏桌面 1280px 的真实随心录编辑器，12 个格式按钮全部实测 48×48px。该流程打开共享 `MarkdownEditor` 的 panel 变体；文章就地编辑使用无工具栏的 ghost 变体，未把不同页面混为同一验收。
- 两种宽度下日程工具 FAB 与助手 FAB 的实际垂直间距均为 46px，没有重叠；打开助手后工具隐藏，关闭后恢复。
- 手机文档树实测高 280px、内部内容高 1754px、`overflow-y:auto`；正文标题位于 y=516px，页面总宽仍为 390px。
- 等待总览与今日计划卡片出现后补拍日程明亮桌面/手机截图，并查看手机文档最终截图，内容与最后修正一致；运行错误和设置写入均为零。

实际检查曾发现通用图标 `:is()` 中的自动 SVG 探测分支带来额外 specificity，压过后置触控规则。该分支现在使用 `:where()` 降低权重，最终的 48px 结果来自正式产物的真实 DOM。Android 本轮按用户选择先交付更新包，真机验收后续进行；浏览器触控模拟不代替 WebView 真机结论。
