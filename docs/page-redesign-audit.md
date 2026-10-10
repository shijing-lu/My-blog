# 全站页面改造盘点（2026-10-08）

对照 44 个 Astro 页面源文件、日程 React 子路由及 63 种设计场景，剩余十个页面已实施。个人中心、确认弹窗和两个开发辅助页面一并收尾。没有发现尚未实施外观改造的内容页；RSS、图片代理和 API 是数据端点。

## 本批已完成

| 页面 | 路由 |
|---|---|
| 标签文章 | /tags/:tag |
| 随心录 | /quick-notes |
| 授权管理 | /admin/auth |
| 网盘 | /admin/netdisk |
| 思维导图列表 | /admin/mindmaps |
| 思维导图编辑 | /admin/mindmaps/:id |
| 登录 | /login |
| 管理入口 | /manage |
| 404 | /404 |
| Markdown 演示 | /demo |

统一暖白纸面、橙红强调、黑色描边与硬阴影，复用首页同源小猫及亮暗令牌。保留原权限、内容格式、接口及数据库结构。修复登录表单被客户端路由拦截的问题，以及思维导图未注册导出插件造成的无文件下载。

## 工程与交付状态

本批 168 项浏览器布局检查和 10 组业务交互通过，页面 JS 错误 0。Astro 检查 678 文件、0 错误、0 警告、45 提示；直接 Astro 构建通过。相关权限及桌面运行测试五文件／89 测试通过。具体证据见 completion-workspace-validation.md。

用户确认保存并退出后，桌面便携包及 APK 均已构建。打包后的桌面载荷在 Electron 中通过 11 组运行检查；APK 签名、版本、原生库及运行载荷检查通过。Android 未连接真机，安装与运行待人工验收。详见 client-redesign-build-validation.md。

## 所有 Astro 路由文件

| 源文件 | 状态 |
|---|---|
| src/pages/404.astro | 已实施对应模块改造 |
| src/pages/admin/auth.astro | 已实施对应模块改造 |
| src/pages/admin/index.astro | 已实施对应模块改造 |
| src/pages/admin/mindmaps.astro | 已实施对应模块改造 |
| src/pages/admin/mindmaps/[id].astro | 已实施对应模块改造 |
| src/pages/admin/nav.astro | 已实施对应模块改造 |
| src/pages/admin/netdisk.astro | 已实施对应模块改造 |
| src/pages/admin/settings.astro | 已实施对应模块改造 |
| src/pages/admin/settings/ai.astro | 已实施对应模块改造 |
| src/pages/admin/settings/appearance.astro | 已实施对应模块改造 |
| src/pages/admin/settings/editor-shortcuts.astro | 已实施对应模块改造 |
| src/pages/admin/settings/hero-quotes.astro | 已实施对应模块改造 |
| src/pages/admin/settings/image-bed.astro | 已实施对应模块改造 |
| src/pages/admin/settings/landing.astro | 已实施对应模块改造 |
| src/pages/admin/settings/md-css.astro | 已实施对应模块改造 |
| src/pages/admin/settings/netdisk.astro | 已实施对应模块改造 |
| src/pages/admin/settings/site-css.astro | 已实施对应模块改造 |
| src/pages/admin/settings/site-name.astro | 已实施对应模块改造 |
| src/pages/admin/settings/sync.astro | 已实施对应模块改造 |
| src/pages/archive.astro | 已实施对应模块改造 |
| src/pages/blog/[slug].astro | 已实施对应模块改造 |
| src/pages/calendar/diary.astro | 带日期跳转至日记弹窗 |
| src/pages/calendar/index.astro | 已实施对应模块改造 |
| src/pages/demo.astro | 已实施对应模块改造 |
| src/pages/design/material3.astro | 已实施对应模块改造 |
| src/pages/diary.astro | 兼容跳转至日历 |
| src/pages/doc.astro | 已实施对应模块改造 |
| src/pages/doc/[id].astro | 已实施对应模块改造 |
| src/pages/edit/[id].astro | 已实施对应模块改造 |
| src/pages/edit/index.astro | 已实施对应模块改造 |
| src/pages/edit/new.astro | 兼容跳转至写作台，不自动创建文章 |
| src/pages/gallery/index.astro | 已实施对应模块改造 |
| src/pages/gallery/manage-cards.astro | 复用已改造影集管理卡片的 HTML 片段 |
| src/pages/gallery/upload.astro | 已实施对应模块改造 |
| src/pages/index.astro | 已实施对应模块改造 |
| src/pages/login.astro | 已实施对应模块改造 |
| src/pages/manage.astro | 已实施对应模块改造 |
| src/pages/moments/[id].astro | 已实施对应模块改造 |
| src/pages/moments/cards.astro | 复用已改造动态卡片的 HTML 片段 |
| src/pages/moments/index.astro | 已实施对应模块改造 |
| src/pages/nav.astro | 已实施对应模块改造 |
| src/pages/quick-notes.astro | 已实施对应模块改造 |
| src/pages/schedule/[...path].astro | 已实施对应模块改造 |
| src/pages/tags/[tag].astro | 已实施对应模块改造 |

## 设计场景逐项对照

| 设计稿 | 场景 | 路由或触发位置 | 状态 |
|---|---|---|---|
| 01-home | 首页 | / | 已实施；见对应批次验收记录 |
| 02-doc | 文档库 | /doc | 已实施；见对应批次验收记录 |
| 03-doc-detail | 文档阅读 | /doc/:id | 已实施；见对应批次验收记录 |
| 04-nav | 网站导航 | /nav | 已实施；见对应批次验收记录 |
| 05-gallery | 影集 | /gallery | 已实施；见对应批次验收记录 |
| 06-calendar | 日历 | /calendar | 已实施；见对应批次验收记录 |
| 07-moments | 动态 | /moments | 已实施；见对应批次验收记录 |
| 08-moment-detail | 动态详情 | /moments/:id | 已实施；见对应批次验收记录 |
| 09-archive | 归档 | /archive | 已实施；见对应批次验收记录 |
| 10-tags | 标签文章 | /tags/:tag | 已实施；见对应批次验收记录 |
| 11-quick-notes | 随心录 | /quick-notes | 已实施；见对应批次验收记录 |
| 12-blog-tech | 技术文章 | /blog/:slug?type=tech | 已实施；见对应批次验收记录 |
| 13-blog-note | 笔记与随笔 | /blog/:slug?type=note | 已实施；见对应批次验收记录 |
| 14-blog-photo | 摄影文章 | /blog/:slug?type=photo | 已实施；见对应批次验收记录 |
| 15-blog-locked | 受保护文章 | /blog/:slug · 未解锁 | 已实施；见对应批次验收记录 |
| 16-edit-desk | 文章写作台 | /edit | 已实施；见对应批次验收记录 |
| 17-edit-detail | 文章编辑 | /edit/:id | 已实施；见对应批次验收记录 |
| 18-edit-new | 新建文章状态 | /edit/new → /edit | 已实施；见对应批次验收记录 |
| 19-admin | 文章管理 | /admin | 已实施；见对应批次验收记录 |
| 20-auth | 授权管理 | /admin/auth | 已实施；见对应批次验收记录 |
| 21-nav-manager | 导航管理 | /admin/nav | 已实施；见对应批次验收记录 |
| 22-netdisk | 网盘浏览 | /admin/netdisk | 已实施；见对应批次验收记录 |
| 23-mindmaps | 思维导图列表 | /admin/mindmaps | 已实施；见对应批次验收记录 |
| 24-map-editor | 思维导图编辑 | /admin/mindmaps/:id | 已实施；见对应批次验收记录 |
| 25-upload | 影集上传与管理 | /gallery/upload | 已实施；见对应批次验收记录 |
| 26-setting-name | 站点名称 | /admin/settings/site-name | 已实施；见对应批次验收记录 |
| 27-setting-quotes | 诗词轮播 | /admin/settings/hero-quotes | 已实施；见对应批次验收记录 |
| 28-setting-landing | 落地页头图 | /admin/settings/landing | 已实施；见对应批次验收记录 |
| 29-setting-appearance | 外观与阅读 | /admin/settings/appearance | 已实施；见对应批次验收记录 |
| 30-setting-image-bed | GitHub 图床 | /admin/settings/image-bed | 已实施；见对应批次验收记录 |
| 31-setting-md-css | Markdown 样式 | /admin/settings/md-css | 已实施；见对应批次验收记录 |
| 32-setting-site-css | 统一外观说明 | /admin/settings/site-css | 已实施；见对应批次验收记录 |
| 33-setting-ai | AI 助手设置 | /admin/settings/ai | 已实施；见对应批次验收记录 |
| 34-setting-netdisk | 网盘对接 | /admin/settings/netdisk | 已实施；见对应批次验收记录 |
| 35-setting-shortcuts | 编辑器快捷键 | /admin/settings/editor-shortcuts | 已实施；见对应批次验收记录 |
| 36-setting-sync | 云端同步 | /admin/settings/sync | 已实施；见对应批次验收记录 |
| 37-schedule-home | 日程 · 今天 | /schedule | 已实施；见对应批次验收记录 |
| 38-plans | 日程 · 计划 | /schedule/plans | 已实施；见对应批次验收记录 |
| 39-schedule | 日程 · 时间表 | /schedule/schedule | 已实施；见对应批次验收记录 |
| 40-execute | 日程 · 执行 | /schedule/execute | 已实施；见对应批次验收记录 |
| 41-review | 日程 · 复盘 | /schedule/review | 已实施；见对应批次验收记录 |
| 42-todos | 日程 · 待办 | /schedule/todos | 已实施；见对应批次验收记录 |
| 43-stats | 日程 · 统计 | /schedule/stats | 已实施；见对应批次验收记录 |
| 44-schedule-settings | 日程 · 设置 | /schedule/settings | 已实施；见对应批次验收记录 |
| 45-motion-lab | 日程 · 动效实验室 | /schedule/motion-lab | 已实施；见对应批次验收记录 |
| 46-login | 登录后台 | /login | 已实施；见对应批次验收记录 |
| 47-manage | 管理入口 · 未登录 | /manage | 已实施；见对应批次验收记录 |
| 48-manage-visitor | 管理入口 · 申请授权 | /manage · 访客已登录 | 已实施；见对应批次验收记录 |
| 49-manage-admin | 管理入口 · 普通管理员 | /manage · 普通管理员 | 已实施；见对应批次验收记录 |
| 50-not-found | 404 · 页面走丢了 | /404 | 已实施；见对应批次验收记录 |
| 51-demo | Markdown 渲染演示 | /demo | 已实施；见对应批次验收记录 |
| 52-design | 界面设计预览 | /design/material3 | 已实施；见对应批次验收记录 |
| 53-profile | 个人中心弹窗 | 公共导航 · 头像 | 已实施；见对应批次验收记录 |
| 54-mode | 明暗模式弹窗 | 公共导航 · 外观 | 已实施；见对应批次验收记录 |
| 55-ai-chat | AI 助手面板 | 公共工具条 · 小卿 | 已实施；见对应批次验收记录 |
| 56-note-editor | 随心录编辑面板 | 公共工具条 · 随心录 | 已实施；见对应批次验收记录 |
| 57-diary-dialog | 日记详情与编辑 | /calendar?open=diary | 已实施；见对应批次验收记录 |
| 58-search | 首页搜索结果 | /?q=Markdown | 已实施；见对应批次验收记录 |
| 59-lightbox | 影集大图查看 | /gallery · 大图状态 | 已实施；见对应批次验收记录 |
| 60-plan-detail | 计划任务详情 | /schedule/plans · 详情 | 已实施；见对应批次验收记录 |
| 61-event-dialog | 新建与编辑日程 | /schedule/schedule · 日程弹窗 | 已实施；见对应批次验收记录 |
| 62-confirm | 删除确认与反馈 | 跨页面 · 危险操作 | 已实施；见对应批次验收记录 |
| 63-boundaries | 空白、加载与失败 | 跨页面 · 状态规范 | 已实施；见对应批次验收记录 |

## 已有模块证据

neobrutalism-homepage-validation.md、article-workspace-validation.md、moments-workspace-validation.md、settings-workspace-validation.md、schedule-workspace-validation.md、discovery-workspace-validation.md、archive-workspace-validation.md、completion-workspace-validation.md。

前批记录为历史证据，本次未声称重跑所有旧模块的业务流程。部分场景仍需用户确认观感、真实云端服务及真机体验。
