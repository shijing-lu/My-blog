# 文档文章编辑体验调研

调研日期：2026-09-27  
对象：文档详情页文章（`/doc/[id]`）的阅读态与原位编辑态  
目的：形成后续实现的行为参考，不复制 Obsidian 的私有实现。

## 结论摘要

Obsidian 的关键体验是「同一编辑视图中的 Live Preview」：正文格式化后仍在编辑器里，Markdown 标记通常被收起；光标进入格式内容时，相关源码重新出现供编辑。它另有 Source mode 用于查看和精确编辑完整 Markdown。阅读视图与编辑视图是一个层级，Live Preview 与 Source mode 是编辑视图内部的两种模式。[官方编辑模式说明](https://obsidian.md/help/edit-and-read)

Obsidian 的公开开发文档确认其编辑器基于 CodeMirror，并通过编辑器 API 暴露相关能力；CodeMirror 的 StateField、Decoration、Widget 是可扩展这种体验的公开机制。[Obsidian Editor API](https://docs.obsidian.md/Plugins/Editor/Editor) [Obsidian Decorations 指南](https://docs.obsidian.md/Plugins/Editor/Decorations) 但 Obsidian 内置编辑器扩展并非这个项目可直接调用的开源组件，因此应对齐可观察的交互与格式支持，不能假设能复用 Obsidian 内部代码。

## 竞品行为观察表

| 领域 | Obsidian 当前公开行为 | 对本项目的借鉴 | 来源 |
|---|---|---|---|
| 阅读/编辑切换 | Reading view 与 Editing view 可切换；编辑模式不是另开一份内容 | 保持文章原位、正文与编辑器的视口连续；入口要明确表达进入编辑状态 | [Views and editing mode](https://obsidian.md/help/edit-and-read) |
| 编辑模式 | Live Preview 和 Source mode 都在编辑视图内；Live Preview 隐藏大部分标记，光标进入格式内容时显示源码 | 继续提供当前默认的无感即时预览；增加明确的「显示源码」退路，避免隐藏语法让用户失去掌控 | [Views and editing mode](https://obsidian.md/help/edit-and-read) |
| 普通 Markdown | 官方基础语法覆盖标题、引用、列表、任务列表、链接、代码、脚注、转义等 | 每种语法需分别定义光标进入、选择、退格、换行和多行选择行为，不只定义静态渲染 | [Basic formatting syntax](https://obsidian.md/help/syntax) |
| 表格 | Live Preview 中可直接编辑单元格；右键菜单支持添加/删除行列、移动/排序、对齐；Insert Table 可插入可编辑骨架 | 目标体验应覆盖单元格输入、键盘移动、结构编辑、对齐和源码往返；仅显示一张可编辑 HTML 表格仍不等价 | [Advanced formatting syntax — Tables](https://obsidian.md/help/advanced-syntax) |
| 引用与 Callout | 引用以 `>` 表示；Callout 是带 `[!type]` 标记的引用块，支持类型、标题、折叠态与嵌套 | 普通引用与 Callout 应是不同的块类型；编辑时保留 Markdown 文本作为唯一数据源 | [Basic formatting syntax](https://obsidian.md/help/syntax) [Callouts](https://obsidian.md/help/callouts) |
| 复杂语法范围 | Obsidian Flavored Markdown 在 CommonMark、GFM、LaTeX 上增加 wikilink、embed、脚注、注释、callout 等 | 先明确项目自身渲染器实际支持的语法；不能把「符合 Obsidian 外观」误写成完整兼容 Obsidian 语法 | [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) |
| 实现公开信息 | Obsidian 暴露 CodeMirror 编辑器 API；CodeMirror 6 的装饰可做文本标记、替换、Widget、行样式 | 现有 CodeMirror 6 架构可继续扩展，不需要整体换成内容可编辑的 HTML 编辑器 | [Obsidian Editor API](https://docs.obsidian.md/Plugins/Editor/Editor) [CodeMirror Reference](https://codemirror.net/docs/ref/) |

## 本次调研边界

- 参照对象为官方帮助文档与公开开发文档，不推测 Obsidian 内部未公开实现细节。
- 官方页面的功能说明只证明用户可观察行为；本项目具体能支持哪些语法，以自己的渲染管线和编辑扩展为准。
- 「动画」问题需在本项目运行时复现并记录视口坐标。代码里已存在 `behavior: 'instant'`，因此仅凭静态阅读不能断言用户看到的移动来自浏览器平滑滚动。

## 参考来源

- [Obsidian: Views and editing mode](https://obsidian.md/help/edit-and-read)
- [Obsidian: Basic formatting syntax](https://obsidian.md/help/syntax)
- [Obsidian: Advanced formatting syntax](https://obsidian.md/help/advanced-syntax)
- [Obsidian: Callouts](https://obsidian.md/help/callouts)
- [Obsidian: Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown)
- [Obsidian Developer Docs: Editor](https://docs.obsidian.md/Plugins/Editor/Editor)
- [Obsidian Developer Docs: Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
- [CodeMirror 6 Reference Manual](https://codemirror.net/docs/ref/)
- [W3C CSSOM View: scrolling behavior](https://www.w3.org/TR/cssom-view/)

