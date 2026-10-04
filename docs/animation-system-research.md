# My-Blog 动效系统技术调研

> 实施更新（2026-09-27）：下文“现状”记录开发前调研。现在普通动效已改为 CSS + WAAPI，`anim.ts` 和热力图不再导入 GSAP；灯箱使用原生 dialog 与图片淡入，未采用共享元素缩放；React 面板关闭即时卸载。最新逐项接入和验证边界见 [开发说明](animation-system-development.md) 与 [走查清单](动效走查清单.md)。

> 调研日期：2026-09-27。本文以当前工作区源码、项目开发文档及 Apple / MDN / OpenAI 官方资料为依据。工作区在调研时含有未提交代码改动；文中源码事实只描述可见现状，不代表这些改动已合并或通过验证。

## 1. 目标与原则

动效应当解释状态变化、确认操作结果、维持空间连续性或提示可操作性。不是每次点击都必须播放动画：导航和按钮 hover 等高频操作保持短促，编辑器键入不附加逐次动效；只有有助于理解的变化才做明显过渡。任何动效都不应阻塞下一次操作，也不能成为成功/失败状态的唯一表达。

Apple HIG 的 Motion 建议是有目的地添加动效、让动作跟随用户手势与预期、反馈短而精准、避免高频交互中重复显眼动画，并允许用户跳过或减少动效。项目可以借鉴这些交互原则与轻量、连续的观感，不应照搬 iOS 物理参数或给网页加入过多弹性效果。[Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)；[Apple HIG: Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)

## 2. 项目开发资料与代码现状

### 2.1 资料来源

| 资料 | 本次用途 |
|---|---|
| `README.md`、`CLAUDE.md` | 开发命令、技术栈、目录、约定与站点功能 |
| `docs/DESIGN.md` | 既有 UI、导航、卡片、主题和访客端交互决策 |
| `docs/architecture/architecture-overview.md` | Astro SSR、React 岛、API/DB、桌面应用边界 |
| `docs/animation-system-plan.md` | 2026-09-15 已有动效设想、优先级和实现路线；本次校正后作为路线参考 |
| `docs/PERFORMANCE-AUDIT-2026-09-26.md` | 最近性能审计和真实项目的性能风险约束 |
| `docs/THEME-DEV.md` | 主题令牌、主题覆盖和运行时机制 |
| `src/layouts/BaseLayout.astro`、`src/layouts/AdminLayout.astro` | 页面框架、路由过渡与管理端导航边界 |
| `src/styles/global.css`、`src/lib/anim.ts` | CSS 动效、GSAP 延迟加载与 reduced-motion 现状 |
| `src/components/ThemeToggle.astro`、`ThemeSettings.astro`、`src/lib/theme.ts` | 主题切换触发与 DOM 状态应用链路 |
| `src/scripts/lightbox.ts`、`src/components/mdx/*`、`src/pages/**` | 图片、折叠、复制、筛选等交互实现入口 |

### 2.2 技术栈与边界

- Astro 7 SSR + Vercel / Node standalone 双 adapter；Electron 桌面应用复用 Node standalone。React 19 只承载部分交互岛，公开页面主要由服务端 HTML、原生 DOM 和 CSS 组成。
- Tailwind CSS v4、Radix/shadcn 风格组件；项目已有 `tw-animate-css`、GSAP 3.15 和 Astro `ClientRouter`。不引入另一套常驻动效依赖，优先使用 CSS；保留 GSAP 给确实需要编排的滚动效果。
- `BaseLayout.astro` 使用 `ClientRouter fallback="swap"`。因此全局委托监听可跨页面复用；每页直接查询/绑定的脚本须遵循 Astro 生命周期重新初始化/清理约定。管理端当前不使用 ClientRouter，切换动画必须考虑完整加载行为和表单/编辑器状态。
- 公开站点有文章、文档、归档、图库、说说、导航、日历等阅读页；管理员另有登录、文章/文档编辑、上传、设置等高交互页面。桌面端另有启动和同步状态。
- 项目已存在滚动揭示、GSAP hero、按钮涟漪/粒子、页面加载指示、阅读进度条、代码复制、对话框、日历提示、Hero 逐字、思维导图锚点反馈等动效。应先统一和修补这些存量交互，再逐步扩展，避免堆叠多种动画造成重复反馈。

### 2.3 交互清单和建议映射

| 交互 / 状态 | 推荐反馈 | 实现与边界 |
|---|---|---|
| 链接导航 / 页面跳转 | 页面内容轻柔淡入或短距离方向过渡；保留清楚的加载进度 | 由已有 Astro ClientRouter 负责；避免新增第二个导航转场控制器。首屏不做大幅移入，避免遮挡内容与感知等待 |
| 亮暗模式 / 主题改变 | 以触发控件为中心的短圆形揭幕，带颜色交叉变化 | 同文档 View Transition 渐进增强；不支持或 reduced-motion 时直接应用；主题实际状态立即生效，不等待动画 |
| 普通按钮 hover / 按下 | 颜色轻变；按下极轻微缩放或亮度反馈 | CSS `transform` / `opacity`；hover 只对有 hover 能力的指针启用，键盘 focus 使用清晰静态焦点环 |
| 右侧工具栏、菜单、dialog | 遮罩淡入；面板短距离滑入/淡入；反向退出 | CSS/Radix 原生状态；动效方向与开关动作一致，关闭按钮与 Esc 均立即有效 |
| 搜索、输入、编辑器键入 | 聚焦边框/焦点环；不为每个字符触发动画 | 纯 CSS 状态过渡；CodeMirror 大量重绘路径避免 DOM 动画和昂贵阴影 |
| 表单验证错误 | 错误文案/边框/ARIA 状态立即显示；必要时对错误容器短促轻微提示 | 错误不能只靠抖动或颜色；无效动画时同样完整可读 |
| 保存成功、复制、收藏/点赞 | 图标/标签切换、短色彩确认；非关键结果用非打断提示 | 状态文本/ARIA live 与动画并存；不为重复保存/复制叠加长动画 |
| 列表过滤、分页、标签切换 | 轻微交叉淡化或即时变化 | 大列表优先即刻过滤，避免全列表 FLIP、逐卡重绘；被过滤元素及时可达性隐藏 |
| 滚动卡片 / 图片加载 | 首屏少量元素轻微错位淡入；图片解码后淡入 | 仅视口内、一次播放、距离小；不能隐藏内容等待 observer；优先 `transform` / `opacity` |
| 文档树、details、Tabs | 面板高度/内容淡入、箭头旋转或选中指示器移动 | 仅展开区的状态反馈；使用原生 `<details>` 时确认浏览器支持和无 JS 降级 |
| 图片灯箱 | 聚焦图像轻微放大/淡入，关闭回到原图位置 | 先保证焦点管理、Escape、滚动锁和图片加载；共享元素 API 仅在唯一名称与可靠回退可行时增加 |
| 目录锚点 / 思维导图跳转 | 轻量高亮目标、目录指示器移动 | 不阻止滚动；不反复闪动长达数秒；遵守 reduced-motion |
| 文件上传 / 桌面同步 | 真实进度、当前阶段和完成/失败状态变化 | 展示真实进度；不能用无限循环动画冒充实际进度；系统通知与托盘提示不依赖屏幕动画 |
| 背景装饰、粒子、持续浮动 | 默认静态或低频，避免全局持续运动 | 尊重减少动效；限制 DOM 节点、离屏暂停、可交互区域不被装饰覆盖 |

清单是全项目审计索引，不表示所有页面都已逐项实现。下一轮按具体代码入口逐项盘点交互，并在实现时更新走查清单。

## 3. 技术选择与性能评估

### 3.1 选型结论

1. **CSS transitions / keyframes 为默认实现**：无需新增 JavaScript 或打包依赖，适合悬停、按压、dialog、简单状态变化和短入场。
2. **View Transition API 只用于页面/主题/媒体等有明确上下文连续性的转换**。Astro ClientRouter 已管理路由生命周期；主题变更是独立 DOM 更新，可以有自己的 `document.startViewTransition()`，但不得在导航处理路径中嵌套另一层转场。能力不可用时直接更新状态。[MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)；[MDN: Using View Transitions](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using)
3. **GSAP 延迟加载并限于需要时间线/ScrollTrigger 的特殊场景**。项目 `src/lib/anim.ts` 已动态加载 GSAP 与插件；普通按钮/状态动画不应因此加载 GSAP。
4. **暂不使用 React Motion 等新库**：项目动效主要在 Astro/原生 DOM/CSS 层，增加依赖会扩大客户端代码和维护面；当前没有证据表明它能解决 CSS、原生 dialog 或 ClientRouter 的缺口。
5. **滚动驱动 CSS 动画暂不作为唯一实现**：支持度和用户偏好处理还需验证；目前保留现有可见性观察机制即可，避免双实现。

### 3.2 性能规则

- 优先只动画 `transform` 与 `opacity`；避免连续动画布局尺寸/位置属性以及大范围模糊、阴影、滤镜。`clip-path` 主题揭幕是有界的单次特效，必须有 reduced-motion/不支持 API 时的即时更新退路。
- `transform` / `opacity` 通常可由合成器处理，但这不是绝对保证；层提升、过多 `will-change`、大面积快照同样有显存和合成成本。只在 DevTools/真机测量后为个别元素添加 `will-change`。[MDN: Animation performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate)
- 持续动画应有必要性和暂停条件；粒子节点设上限并在动画结束后移除；列表动效只给新项/视口内少量元素，不对成百项目批量 FLIP。
- 反馈类动画不延迟业务状态更新，不挡住输入、焦点、Esc 或第二次操作。页面内容首次绘制时必须可读，不依赖动画回调解除 `opacity: 0`。
- 性能验证不能只依据属性名或经验推断，需在目标 Chromium/Electron 与 Safari/Firefox 检查帧率、主线程长任务、首屏绘制和 reduced-motion。

### 3.3 无障碍

- `prefers-reduced-motion: reduce` 时取消不必要的位移、缩放、扩散、视差和循环动画；保留状态差异、焦点可见性、成功/失败文本与操作反馈。
- 动画不作为唯一状态表达；兼顾键盘、屏幕阅读器、触摸/指针；焦点样式不随动效关闭。
- 任何动效都可被新交互立即打断；不使用闪烁或反复高对比动画。

## 4. 与 2026-09-15 计划的校正

- 不把“所有动画只许使用令牌值”当作第一阶段门槛；仓库已有大量页面级独立关键帧，强行一次性替换会扩大 CSS 改动和回归面。先集中新增系统与关键交互，再迁移既有样式。
- 同文档主题变更可以独立用 View Transition，但路由转场继续交给 Astro；不能依赖自定义 `data-vtActive` 猜测 ClientRouter 内部状态，也不把两套转场统一塞进 `applyState()` 的承诺视为已验证。
- 不预设主题揭幕圆形 `clip-path` 一定比淡化更快；把它作为单次视觉特效，检查中低端移动设备上的流畅度，若不佳就退化为短交叉淡化。
- 动效数量、屏幕大小和运行设备会影响实际开销。验收以页面可交互性、稳定帧率、首屏无隐藏内容、无布局跳动为准；不能仅用“60fps”单一数值证明体验良好。
- 原计划所述“现有 370 用例”已过期；以当前 `package.json` 脚本和最近性能审计为准。测试由任务范围与项目工作流决定，不把过期数字作为验收基线。

## 5. Codex 模型与额度评估

本项目任务包含源码审计、动效交互取舍、官方资料查证、跨 CSS/Astro/TypeScript 改动、浏览器兼容判断和实际验证。对单次实施而言推荐 **GPT-6 Sol，medium reasoning**：官方将 Sol 定位于复杂编码/agent 工作流；medium 给跨文件实施保留足够判断力，成本又低于 Astra。若当前客户端额度优先，可对文档归纳、单文件 CSS 调整、格式修订和已确定范围的修补用 **GPT-6 Luna，low/medium**；遇到共享元素、导航生命周期、性能回归等复杂整合，再切回 Sol。Astra 仅用于出现难以复现的跨模块问题或需要高把握的架构审查。

这是一项基于本任务特点的建议，不等同于对用户账号额度或所有 Codex 任务的固定承诺；模型可用性和计划额度因账户/产品而异。减少消耗优先靠工作方式：先读既有计划和性能文档；基于源码证据建立一次交互清单；把每个阶段限定到可 review 的文件；不反复输出同一上下文；按风险逐级提高 effort，而不是全程使用最大模型。OpenAI 官方当前将 GPT-6 Luna 定位为高频低成本任务、Sol 定位为复杂编码与成本平衡、Astra 定位为最困难的端到端工作；模型选择还应以真实代表性任务的成功率、重试次数、延迟和额度消耗比较。[OpenAI Models](https://developers.openai.com/api/docs/models)；[OpenAI Model selection](https://developers.openai.com/api/docs/guides/model-selection)

## 6. 参考资料

- Apple, [Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)；[Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- MDN, [Animation performance and frame rate](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate)；[View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)；[Using the View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using)
- OpenAI, [Models](https://developers.openai.com/api/docs/models)；[Model selection](https://developers.openai.com/api/docs/guides/model-selection)
