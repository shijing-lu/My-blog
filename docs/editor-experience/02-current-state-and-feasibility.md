# 文档文章编辑：现状与可行性分析

调研日期：2026-09-27  
范围：文档详情页，不包含管理后台独立写作页和普通文章后台编辑页。

## 当前实现结构

| 层 | 当前实现 | 主要位置 |
|---|---|---|
| 阅读内容 | 服务端渲染后的 `<article class="prose">` | `src/pages/doc/[id].astro` |
| 原位编辑宿主 | 登录用户才加载 React 岛；点击入口后按需取源 Markdown，隐藏原文章并在原位挂载 CodeMirror | `src/pages/doc/[id].astro`、`src/components/doc/DocInlineEditor.tsx` |
| 编辑器内核 | CodeMirror 6，ghost 外观、行号关闭、Ghost/Panel 两种视觉变体共用 | `src/components/admin/MarkdownEditor.tsx` |
| 即时预览 | `livePreview` 与 `wysiwygPreview` 使用 CodeMirror StateField / Decoration；WYSIWYG 模块动态加载，含 KaTeX 渲染 | `src/components/admin/cm-live-preview.ts`、`src/components/admin/cm-wysiwyg.ts` |
| 表格 | 将 Markdown 表格替换成可编辑 Widget；支持 Tab / Shift+Tab、末格 Tab 或 Enter 新行、空数据格 Backspace 删除行、分隔行对齐、竖线转义 | `src/components/admin/cm-table.ts` |
| 快捷键 | 粗体、斜体、删除线、行内代码、链接、代码块、标题、引用、列表和任务列表命令；支持自定义键位 | `src/components/admin/md-keymap.ts`、`src/lib/md-commands.ts`、`src/lib/editor-shortcuts.ts` |
| 保存与定位 | 1.5 秒自动保存；按标题锚点恢复阅读位置；编辑中防文章切换，未保存时阻止离页 | `src/components/doc/DocInlineEditor.tsx` |
| 性能措施 | 编辑正文预取；WYSIWYG 动态加载；装饰缓存；状态栏 DOM 直写，避免每次键入触发 React 重渲 | `src/lib/doc-viewport.ts`、`src/components/admin/cm-preview-cache.ts`、`src/components/admin/MarkdownEditor.tsx` |

## 需求可行性表

| 需求 | 当前差距/待核实 | 可行方案 | 难点与风险 | 可行性 |
|---|---|---|---|---|
| 去掉预览切编辑时的滚动动画 | `openEditor()` 当前保存阅读锚点，并多次执行 `instantScrollTo()`；项目同时全局设置 `scroll-behavior: smooth`。按 W3C 规范，显式 `instant` 应即时滚动；运行时仍感到滚动，说明要排查实际滚动目标、布局替换和重复对齐，而非直接相信注释或把所有定位逻辑删除 | 录制切换期间的 `scrollY`、文章/编辑器 `getBoundingClientRect()` 与每帧位移；分别关闭进度条/透明度反馈、标题锚点校准和任何页面转场，锁定来源；目标是保持同一内容锚点在视口中的位置且没有逐帧移动 | 无条件取消定位会令长文用户跳到错误段落；移除撑高和锚点会重新引入页面高度塌陷、滚动夹位 | 高；先复现再改 |
| 点击后给清楚反馈 | 当前代码已经让文章变淡并显示顶部不确定进度条，随后编辑器直接替换正文；WYSIWYG 默认隐藏 Markdown 标记，外观又与正文接近，容易看起来「什么也没发生」 | 入口立刻变成「编辑中/完成」；在文章标题旁或固定工具区保留小而稳定的编辑状态；编辑器一挂载立即聚焦并显示光标/当前块源码；只在真实加载时显示加载反馈 | 太强的底色、卡片和进入动效会破坏无缝原位感；反馈未区分加载与编辑中会造成误操作 | 高 |
| 普通格式化文本编辑自然 | 已有标题、加粗/斜体/删除线、链接、图片、行内代码、行内/块级公式、代码块、水平线、列表和任务列表的预览/装饰；格式源码多数按光标位置显隐 | 以 Obsidian Live Preview 的「当前块源码可见、其余内容呈现结果」作为一致性模型；逐种覆盖光标进入/离开、跨格式选择、撤销重做、粘贴与 IME 输入 | 当前装饰计算和行级解析的边界条件需覆盖转义、未闭合语法、嵌套格式、多光标与超长行 | 高；沿用已有内核 |
| 表格好编辑 | 表格 Widget 已能改单元格和基础键盘导航；目前代码注释未显示 Obsidian 风格结构上下文菜单（行列增删、移动/排序、对齐、插入表格），需要以实际运行确认工具是否另有入口 | 保留 Markdown 为规范化数据源；补充表格操作菜单和 Insert Table 命令；每个操作以单次 CodeMirror transaction 写回 Markdown，并保持焦点、选区、撤销栈 | 竖线转义、不同列数、空表格、表头与首行约束、公式/链接单元格、复杂选区；DOM contenteditable 和 CodeMirror selection 同步较脆弱 | 中高；需专门测试 |
| 引用块与 Callout | 当前 WYSIWYG 只隐藏 `>` 并给引用文字加样式；源码注释明确 Callout 与普通引用相同处理，没有 Callout 类型/标题/折叠显示 | 先将连续引用行分组，普通引用渲染成引用块；识别 `> [!type] title` 并呈现 Callout；光标进入块或相关行时还原 `>` 与 `[!type]` 源码 | 多段引用、引用中的空行/列表/代码块、嵌套引用和 Callout、折叠标记语义；确保编辑器展示与文章的 MDX 渲染器一致 | 中高；需要块解析与交互设计 |
| 完整 Obsidian 语法兼容 | 文章渲染器是 MDX/remark/rehype 管线，并非 Obsidian Markdown 管线；语法和扩展集合不相同 | 先基于渲染器登记语法支持表，只承诺项目已有语法；若确需 wikilink/embed/注释等，再独立定义数据库、渲染与编辑器三边兼容规则 | 引入 Obsidian 专属语法可能造成文章渲染、同步、导出和桌面端离线表现不一致 | 有条件；不建议本轮承诺全量兼容 |

## 进入编辑时的滚动诊断结论

从静态代码可确认：

1. 页面全局滚动行为为 smooth，但本功能定位工具显式使用 `behavior: 'instant'`；规范说明 `instant` 应直接到位，`auto` 才会受 computed `scroll-behavior` 影响。[W3C CSSOM View](https://www.w3.org/TR/cssom-view/) [MDN Window.scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollTo)
2. 编辑器进入前把页面滚到文章顶部，原文短暂隐藏后再挂载 CodeMirror，随后用标题锚点恢复内部位置；长文可能还有 300ms/900ms 的延迟再校准。任何一个步骤的坐标系、时序或缓动都会被感知为移动。
3. 加载反馈会把文章透明度改成 0.4，并执行 150ms opacity transition，同时显示顶部移动进度条；这不是滚动动画，但会让用户看见过渡。
4. 因此先做浏览器运行时 trace，再决定是取消页面级对齐、保留即时单帧定位，还是只去掉加载态淡化。必须保留「不跳错文章段落」这一定位目标。

## 预期边界

- 「无感」指阅读稿与编辑视口内容无突兀位移、语法标记不会充满屏幕、编辑入口状态清楚；不等于在光标之外永久隐藏错误/未闭合 Markdown。
- 所见即所得装饰不是新的内容存储格式。数据库仍保存 Markdown 源文，编辑器显示层不可反向污染文章渲染结果。
- Obsidian 可做功能参照，但对它的语法支持只可作为候选需求，不自动成为本项目承诺。

