# 动态模块验收记录

本批完成动态列表、动态详情、发布区、编辑弹窗及本批删除确认弹窗的扁平主义与新粗野主义外观。沿用首页视觉令牌和明暗模式，标题与空态复用首页探头猫，页脚继续使用公共趴猫。

## 本地预览

- [动态列表](http://127.0.0.1:43224/moments)
- [图文详情](http://127.0.0.1:43224/moments/e0f65ecf-872a-4900-a75d-fecd12aa1811)
- [长内容详情](http://127.0.0.1:43224/moments/93ab0056-e2dd-4c72-b965-f88811e8875e)
- [媒体失败状态](http://127.0.0.1:43224/moments/f354165a-67be-47cb-a2bf-a80c85c7271c)
- 本地站主密码：`article-review-local`。登录后显示发布、编辑、删除及私密动态。
- 当前服务器：`scripts/serve-moments-review.mjs`，43224 端口；数据仅写入 `outputs/moments-workspace/test.db`。
- 数据库从上一批隔离验收副本复制，新增 29 条标明“验收示例”的动态。副本中保留了上一批的特殊字符昵称用例；没有修改实际资料和内容。

## 本批变化

- 暖白纸面、橙红页签、黑色描边和硬阴影；操作图标沿用 Lucide。阅读正文与共享评论组件内核保持原有功能。
- 桌面日期时间线独立滚动，并预留工具条空间；手机日期区可收起，标签栏局部横向滚动，操作目标至少 44px。
- 卡片时间链接打开详情；详情标签返回列表筛选。首屏、筛选、加载更多、发布与编辑后的卡片共用同一服务端模板。
- 编辑弹窗默认整宽输入，点击预览后桌面分栏、手机上下排列；Esc 和取消后恢复编辑按钮焦点。
- 页面切换时解绑旧事件并清理观察器、筛选请求及定时器。URL 筛选刷新后恢复，避免旧响应覆盖新筛选。
- 上传时禁止发布／保存；保存和删除失败保留正文／卡片供重试；成功发布与删除同步实际总数和时间线计数。
- 图片失败显示稳定占位，避免残留无效灯箱入口。
- 未修改公共 API、数据库结构、内容类型、权限判定或共享评论组件；未开发其他模块。

## 已完成检查

- Astro check：675 个文件，0 errors、0 warnings、43 hints。
- 5 个既有测试文件，共 48 项通过：动态纯函数、Markdown 管线、管理员权限／权限渲染、图片校验。
- 直接 Astro Node 构建通过；存在构建器既有大文件提示。未调用包含迁移和云数据库验证的总构建命令。
- 浏览器：Edge Chromium 无头模式，游客／站主身份，1440、1320、1280、941、768、390、360px，亮色／暗色，共 70 组布局检查；无页面级横向溢出，页面只有一个主标题。
- 运行时检查：
  - SSR and load-more share complete cards and hydrate without duplicate IDs
  - search empty state, clear, full-data tags, URL refresh restoration and selected timeline feedback
  - private publish and preview, in-place editing and preview, failed save retains text for retry, failed deletion retains card, successful delete and real count updates
  - picker images and GIF upload protocol mocked at external storage boundary, upload disables publish, media removal and video URL validation
  - ClientRouter leave/return rebinds to new publishing and preview elements
  - keyboard image lightbox, Esc focus restoration and stable broken-image placeholder
  - real local content like/unlike and anonymous comment publish/collapse/expand using existing APIs
  - guest private content/tag/partial protections and denied publishing; mobile date toggle and 44px rows
  - reduced-motion rendering
- 保存 21 张截图；浏览器未捕获页面 JavaScript 错误。完整结果：`outputs/moments-workspace/browser-report.json`。

## 验证边界与人工确认

- 图片／GIF 的文件选择、压缩请求、等待反馈及移除操作已验证；上传接口使用模拟成功响应，未向真实 GitHub 图床或 R2 写入文件。真实存储、系统剪贴板粘贴仍需人工测试。
- 直接视频、B站与 YouTube 的既有渲染路径保留；第三方网络、解码、全屏播放仍需人工验证。
- 点赞和匿名评论使用隔离数据库中的真实 API；GitHub OAuth 登录依赖外部授权，未进行真人授权测试。
- 暗色和减少动态已检查；文字、布局、手机工具条的视觉舒适度请人工确认。
- 本批浏览器验收不能替代真实 Electron 桌面客户端或 Android 设备验收；未重新打包客户端。
- 未发布网站，停在本批验收。

## 截图与复现

- 截图索引：`outputs/moments-workspace/screenshots.html`。
- 启动：`node scripts/serve-moments-review.mjs`。
- 如需重新生成隔离示例：`node scripts/seed-moments-review.mjs`（已有示例会保留）。
- 回归：`node scripts/verify-moments-workspace.mjs`。
