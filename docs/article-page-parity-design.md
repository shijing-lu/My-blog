# 首页文章页面复用与目录右键：技术设计

> 依据：[需求规格](article-page-parity-requirements.md)。状态：设计稿，尚未执行迁移和代码改造。设计以 2026-09-28 仓库为准。

## 1. 当前实现与差距

| 能力 | 当前文件与事实 | 设计后责任 |
| --- | --- | --- |
| 文档详情 | `src/pages/doc/[id].astro`：`BaseLayout`、SSR 树/MDX/TOC、左右栏状态机、页内文章切换、节点 CRUD；页面脚本超过千行 | 变成共享页面骨架的文档适配器，保留其 URL/缓存/长文行为 |
| 文档树渲染 | `src/lib/doc-tree-render.ts`：服务端和客户端复用纯函数；节点行内输出＋文/＋目/移动/编辑/删除按钮 | 抽象树视图并撤除行内 CRUD 按钮；保留展开、当前项、拖放数据标记 |
| 文档原位编辑 | `src/components/doc/DocInlineEditor.tsx`：按需取源、可视化 CodeMirror、自动保存、切换定位 | 抽出数据源无关的生命周期/视口处理，以适配器注入读写/预览；避免双写 |
| 首页编辑 | `src/pages/edit/[id].astro` + `AdminLayout` + `LiveEditor.tsx`：独立全高写作台；左栏为平面分类，右栏为简化 TOC | 切为共享页面骨架；文章专有字段搬到设置 UI，旧写作台的保存/加密/发布能力复用 |
| 首页分类 | `article_categories` 目前没有 `parent_id`；`article_post_categories` 以文章 ID 主键表示单目录归属 | 分类表新增父 ID，升级为目录树；映射表继续一篇一目录 |
| 文章与目录 API | `/api/article-categories` 混合 GET/POST/PATCH/DELETE，当前删分类只解除归属 | 保持兼容入口并增加父 ID/路径/事务与环验证；页面通过域适配器调用 |

单纯将 `LiveEditor` 的左、右栏 CSS 改成文档样式不能满足要求：文档页还包含面包屑、悬浮 TOC、同位预览/编辑、快速文章切换及复杂的视口恢复。应抽取共用组件/控制器，两个路由都调用，避免同一需求需要维护两份 DOM 和脚本。

## 2. 推荐分层

```text
BaseLayout（全站外壳）
  └─ ArticleDetailShell（同一页面结构、尺寸、目录开合与响应式行为）
      ├─ TreeRail（左树；只接收统一节点、当前项与命令）
      │   └─ TreeContextMenu（根/目录/文章菜单、键盘/触屏入口）
      ├─ ArticleCanvas（标题/状态/正文/预览/原位编辑）
      │   └─ InlineVisualEditor（同一 Markdown 编辑与切换控制器）
      └─ HeadingTocRail（右 TOC，预览/编辑一致）
             ↑
        DocAdapter 或 HomeArticleAdapter（数据、权限、命令、专属插槽）
```

建议先从文档页面抽出无数据源假设的 Shell、左栏和右栏，再接入首页文章。文档页仍负责 SSR 查询和生成初始 HTML；首页编辑页也 SSR 初始选中文章、树与预览骨架，避免客户端岛下载前白屏。React 岛负责交互，不让整个页面每次输入都重渲。`#doc-*` 选择器逐步改为作用域内 `data-*`/refs；过渡期保留兼容桥，待两路由均稳定再移除专用 ID。不要同时重写 Markdown 解析器或编辑器扩展。

### 2.1 统一视图模型

```ts
type Domain = 'docs' | 'home';
type TreeNode = {
  id: string; parentId: string | null; kind: 'folder' | 'article';
  title: string; sort: number; createdAt: string; updatedAt: string;
  published?: boolean; // 仅首页文章可用
};
type ArticleHeader = {
  id: string; title: string; contentVersion: string;
  domain: Domain; canEdit: boolean; published?: boolean;
};
type ArticleCommands = {
  createFolder(parentId: string | null, name: string): Promise<TreeNode>;
  createArticle(parentId: string | null): Promise<TreeNode>;
  renameNode(id: string, name: string): Promise<TreeNode>;
  deleteNode(id: string): Promise<{ affectedIds: string[]; nextActiveId?: string }>;
  loadArticle(id: string): Promise<{ markdown: string; html: string; toc: unknown[] }>;
  saveArticle(id: string, markdown: string): Promise<{ version: string }>;
};
```

这是组件边界草案，不规定最终导出名称。UI 中的 `folder` 映射文档目录或首页文章目录；文章映射 `doc_nodes(kind=article)` 或 `articles`。域适配器负责各自 API、URL、权限、删除语义。TOC 只依赖当前 Markdown/渲染结果，不能从左树推导。文章专属属性通过 `home` 插槽传入，不在共用 Shell 硬编码加密字段。

### 2.2 URL 与页面状态

- 文档页保留 `/doc/:bundleId?article=:nodeId`。首页编辑页保留 `/edit/:articleId`，树中点击其他文章更新路由或使用 History API，刷新后仍可定位当前文章；必须在未完成保存时阻止静默丢失。
- 新首页草稿沿用 `/edit/new` 先创建记录的流程，带目录 ID 创建。现有文章首次进入可呈预览态，点击“编辑”原位切换；从新建动作进入必须直接启动编辑器且首帧即为可视化。
- 左树折叠状态、展开目录 ID、树滚动、右 TOC 状态与正文滚动分别管理；文章切换不依赖整页 reload。TOC 章节跳转在阅读态和编辑态都有效。
- 右键菜单状态 `{domain, nodeId|null, kind:'root'|'folder'|'article', anchorRect}`，每次打开重新定位；切域/节点消失时关闭。菜单不直接持有数据库对象，命令执行前以当前树校验目标。

## 3. 目录树与菜单设计

### 3.1 DOM/交互

树节点行只展示标题、折叠箭头和必要状态（如草稿）。鼠标右键由**树容器单一委托监听器**处理；依据 `closest('[data-tree-node-id]')` 获取节点，空白处视为根。`event.preventDefault()` 仅在管理员可操作的树容器内执行；正文编辑器保留自己的右键 Markdown 菜单。目录 `<summary>` 的右键需要避免默认展开/收起；左键仍正常。点击菜单项先关闭菜单再执行对应命令，并在完成后恢复焦点和树状态。键盘菜单键/`Shift+F10` 聚焦行的中心定位菜单；触屏长按触发同一菜单，同时抑制随后合成 click，防意外切文章。

菜单建议使用可定位的 `role="menu"`/`menuitem` 结构、箭头键循环、Home/End、Escape、焦点回归；长按阈值和误触容忍度在实现时按设备验证。浮层做视口碰撞处理，最大高度可滚动，层级高于正文但低于模态确认框。减少动态效果时不播放位移/缩放动画。菜单组件不关心是文档还是首页，仅由权限与节点类型生成可见命令。

### 3.2 命令矩阵与保护

```text
root:    createArticle, createFolder
folder:  createArticle, createFolder, editFolder, deleteFolder
article: editArticle, deleteArticle
```

`createArticle(folderId)` 与 `createFolder(folderId)` 服务端均验证目标存在、为目录且属于当前域/册。文章作父级返回 400，页面不进行乐观插入。删目录先 GET/本地计算影响摘要，再确认，再由服务端事务处理；提交后返回规范的新树局部数据。快速双击同一菜单命令应禁用重复提交。原行内 CRUD 控件移除后，保留顶部根级按钮和行尾“更多操作”键盘/触屏入口；二者都调用同一命令实现。

## 4. 首页文章目录迁移

### 4.1 数据库

在 SQLite 与 PostgreSQL 的 `article_categories` 增加 `parent_id` 可空列与索引。旧分类的 `parent_id=NULL`，原 `sort`、颜色、名称、文章归属保持不变；`article_post_categories` 继续用 `article_id` 主键，`category_id` 指向某一个真实目录。“未分类”只在查询结果和 UI 中合成，数据库不建虚拟目录记录。目录仅含目录和文章两种 UI 节点，但底层文章仍留在 `articles`，不复制到分类表。

迁移必须随现有迁移体系提供 SQLite 与 PostgreSQL 两侧脚本/快照；先核对生产库已有分类迁移版本。服务端在迁移前不得请求不存在的 `parent_id` 列；新代码与库升级顺序、桌面本地库启动迁移要明确，避免旧便携版启动 500。桌面同步表 `article_categories` 已登记为 LWW；新增字段须进入两端序列化/列清单与冲突处理，升级后旧端不能把新父 ID 写回空值。`article_post_categories` 同步保持单归属语义。

### 4.2 不变量

- 父目录为空或存在；不得自引用、指向后代、跨域/跨册；服务端移动目录时查询整条祖先链，限制异常深度/环以防死循环。
- 同级 `sort` 唯一性可由事务内重排保证；同名允许或拒绝须与当前“全局拒重名”接口兼容。推荐改为**同级拒重名**，跨目录可重名，前端显示完整路径辅助识别。
- 文章只能属于一个目录；移动文章是更新映射，不是复制。目录删除的“提级子目录 + 直接文章归未分类”在一事务中完成；失败回滚，树不更新。被提升子目录的子树及其文章归属不变。
- 改名/移动目录后面包屑和选择器路径即时更新。旧分类设置界面和文章分类过滤必须能读层级路径，不能继续按平面名称唯一查找。

### 4.3 API 演进

保留 `/api/article-categories` 的现有外部调用语义，并在 GET 返回 `parentId`、路径/树所需排序字段；POST 接受可空 `parentId`；PATCH 目录更新接受 `parentId` 并验证环，重排限制同级；DELETE 执行上述保文章事务。新页面的“创建草稿”接口接受可空目录 ID并在同一操作里建立文章归属，避免建草稿成功却挂目录失败。必要时拆出 `/api/article-folders/:id` 以使操作语义清晰，但迁移期间旧调用方须保持可用。

## 5. 原位编辑与文章设置

共用编辑控制器负责装载源码、初始化可视化扩展、预览、最新版本自动保存、离页/切文保护、视口锚点与保存状态。保存数据采用域适配器：文档 `PATCH /api/doc/nodes/:id`，首页文章沿用 `/api/save-draft`，且不因自动保存改变 `published`。首页文章设置只操作当前文章字段，复用旧 `LiveEditor` 对标签、封面、类型、摘要、加密提示、密码变更及发布的业务逻辑。密码开关的 UI 必须与现有加密数据契约保持一致，不把旧密码返回浏览器。草稿预览仍仅管理员可访问，公开预览接口不得被误用为草稿读取通道。

首页和文档用同一 `renderMdx`/TOC 生成路径及文章正文 CSS。保留文档页对超过 96KB 源文延迟渲染、渲染缓存版本、图片尺寸注入的已有优化；首页长文要复用相同策略，避免一篇长文章使 SSR 白屏。切文只取目标正文，左树初始 HTML 只注入元数据，不能在树 JSON 中塞全部文章 Markdown。

## 6. 权限、安全与失败模式

- `/edit/:id` 和首页文章树 API 仅管理员；访客不得通过目录数据获取草稿标题、标签、正文或密码提示。文档公开阅读不因管理员菜单注入而泄露写权限。
- `article` 节点不能作为父节点、目录移动不能成环，这些需 API 与数据库事务验证。前端应捕获 401/403、404、409 并显示可操作错误。
- 删除目录的确认摘要在确认后可能过期；服务端事务仍按最新状态执行并返回实际影响数。若与确认时不一致，推荐返回 409 要求重新确认。
- 保存失败保留编辑器内容，禁止切文导致未保存内容丢失；目录操作失败不重建树。异步切文使用序号/AbortController 抛弃过期结果。
- 文章专属设置抽屉不能影响正文滚动锚点；开关密码时必须提供明确的加密/解密状态反馈。

## 7. 技术决策与复杂度

| 方案 | 取舍 |
| --- | --- |
| 两个路由共用 Shell + 域适配器 | 推荐。保持真正一致，同时可区分两域 API 与删除语义；重构量较大，但长期维护成本较低 |
| 复制 `doc/[id].astro` 到首页并替换 API | 不采用。现有页面脚本很长，复制后菜单/TOC/视口修复会重复且易漂移 |
| 只给 `LiveEditor` 换 CSS | 不采用。解决不了 SSR 首屏、面包屑、同位预览、TOC 状态与目录树操作差异 |

复杂度评估：共用页面/编辑生命周期**高**，双数据库嵌套目录迁移与同步**高**，目录右键 UI **中**，菜单键盘/触屏及回归**中高**。工作应先固定交互和数据语义，再切层；禁止一笔提交同时改迁移、编辑器和全部页面。详见开发计划。
