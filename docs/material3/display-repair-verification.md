# Material 3 显示修复验收 · 1.1.1

日期：2026-10-05。范围和顺序见 [修复计划](display-repair-plan.md)。没有新增 API、数据库表或迁移。

## 问题与实施

| 问题 | 修复 |
| --- | --- |
| 弹窗继承导航 nowrap，内容列撑到 1328px | 正常换行、minmax(0,1fr)、可收缩字段组；顶部导航选择器限定直接子导航，避免覆盖弹窗内部滚动 |
| 关闭按钮移出屏幕 | 独立 64px 标题栏；840px 以下全屏弹窗，内容独立纵向滚动 |
| 字体、Markdown 下拉框和其他字段挤窄 | 以实际内容容器宽度排列：560px 以下单列、560px 起双列、840px 起三字段组可三列；跨列字段改为 1/-1，消除单列下隐含第二列 |
| 设备风格文字截断/面板偏移 | 480px 以下选项纵向排列，标题、说明、按钮正常换行；内部宽度检查通过 |
| 头像零宽、图标/FAB 受文字按钮样式影响 | 使用独立 button/icon-button/avatar-button/navigation-item/FAB 语义；文字按钮几何使用低优先级规则，Material 头像 32px、FAB 容器 56px |
| 设置名称、搜索和环境入口不一致 | 弹窗及独立页共用 settings-sections；统一“外观”，支持 Material/Google/字体/背景搜索；同步按桌面环境显示 |
| 旧配置混杂 | 字体、背景与 CSS 纳入可展开的“现有风格设置”，明确 Material 下不生效，保留原值及保存能力；经典风格自动展开 |
| Escape 抢走焦点 | 前景 dialog 接管 Escape，后台快捷工具栏不隐藏弹窗入口、不抢占焦点 |

## 验证矩阵

自动写入仅使用隔离 SQLite 副本及 fixture；上传和设置失败使用模拟响应。正式站检查不修改设置及正文。

| 验证 | 结果 | 证据/脚本 |
| --- | --- | --- |
| 单元测试 | 71 文件、924 测试通过 | `unit-tests-1.1.1.log` |
| Astro/TypeScript | 620 文件、0 错误、0 警告、42 既有提示 | `astro-check-1.1.1.log` |
| 桌面最终构建 | 通过 | `build-desktop-1.1.1.log` |
| 全站最终构建完整重跑 | 50 入口 × 2 风格 × 3 模式 × 5 宽度，1500/1500；异常/console 错误/溢出/被拦截写入均为 0 | `verify-material3.mjs`；`coverage.json`、`coverage-1.1.1-run.log` |
| 就地切换/公共浮层 | 4 代表页 120 次原页切换；系统主题、焦点/Tab/Escape/Radix 交互通过 | 同上 |
| 设置专项 | 42 组合（2 风格、3 模式、320/390/768/839/840/1280/1920px）× 11 弹窗分区、11 独立页、个人面板，共 966 次采样 | `verify-material3-settings.mjs`；`repair-1.1.1/settings-verification.json` |
| 设置交互 | 分区/搜索/无结果、Tab/Shift+Tab/Escape、未保存字段随窗口缩放与换肤保留、保存中/成功/失败回退；0 写入 | 同上。布局采样后仅追加 Escape 修正，交互重新运行通过 |
| 真正 200% 浏览器缩放 | 2 风格 × 3 模式 × 2 窗口 × 12 面板，144 次通过；1280px 窗口实为 640 CSS px、DPR 2 | `verify-material3-zoom.mjs`；`repair-1.1.1/zoom-verification.json` |
| 编辑器/正文 | 文章和文档 EditorView/DOM 身份、光标、撤销、折叠、7516 字符源文完整自动保存、五宽度通过 | `verify-material3-editor.mjs`；`editor-verification.json` |
| 相册/加密阅读 | 两风格粘贴队列、压缩载荷、进度、失败重试、错误/正确解锁和折叠通过 | `verify-material3-media-gate.mjs`；`media-gate-verification.json` |
| 正式访客 | 首页/文档/设计预览 × 2 风格 × 390/1280px，12 组合通过；公开读 no-store，访客写拒绝 | `verify-material3-release.mjs`；`production-1-1-1-verification.json` |
| 正式管理员设置 | 320/390/1280px × 10 分区，30 次通过；内部宽度、关闭按钮、活动分区正确，0 内容写入 | `repair-1.1.1/production-settings-verification.json` |
| 真实 Windows 窗口 | Electron 44.3.0、appVersion 1.1.1；两风格与 22 分区通过，Material 头像 32px，原偏好恢复 | `repair-1.1.1/real-desktop-verification.json` |

200% 使用 [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom) 的 setZoom/getZoom 实际设置及读取 2，没有用 CSS zoom、pinch 或 deviceScaleFactor 替代。截图复核含正式站 320px 设置、390px 设备面板、839/840px 和缩放边界。966 次采样记录两种风格；Material 内部几何、关闭按钮和字段宽度是新增严格断言，未把经典风格既有内部布局算成已修复。

原始报告与截图在 `outputs/material3-review/`，可能含站点内容，不提交源码。

## 数据、部署与客户端

Vercel 构建真实检查主备 PostgreSQL：各 36 表、0 新增列；settings KV 镜像 upsert/read、ORM CRUD/returning/时间戳、Cadence revision/CAS/tombstone，以及主库失效后的备库读写均通过。沿用既有持久化及同步。原 Material 功能的 6 次临时 key 真同步证据保留于 `settings-sync.json`，本轮没有把它写成重新执行了真实两设备全量同步。

正式站：[白衣卿相](https://www.byqx-blog.online/)。应用源码部署 `dpl_F26koeNYBFAAipZpLQDgUGk9djWc` Ready 后已 promote，数据库证据见 `vercel-1.1.1-deploy.log`。随后版本清单/文档发布单独记录，UI 源码保持与已验构建一致。

Windows 已更新实际便携客户端，仅替换程序 `dist/desktop/package.json`，原程序备份于 `release/material3-before-1.1.1/app`；APPDATA 中数据库、密钥、配置保留。临时窗口验收钩子仅用于本地安装副本，验收后恢复与发布包相同的原 main.cjs，并正常重启；不纳入 Git 或安装包。正常启动同步完成，无错误。

Windows NSIS、Android Release 均为 1.1.1，Android versionCode 6。校验、签名及下载见 [发布清单](release-1.1.1.md)。远程更新提示清单同步为 1.1.1。

## 验收边界

- Android 按用户安排先交付包，真机后续补做；浏览器/coarse 模拟不算 WebView、系统返回、旋转、系统剪贴板、文件授权真机通过。
- 1500 组合证明访问、风格和页面布局；设置追加内部几何断言。其他模块每项增删改和错误状态的边界继续见 [覆盖矩阵](coverage.md)，未扩写为全部人工验收。
- 源文含 H1–H6，但换肤回归明确操作 L2 折叠，不声称六级标题逐级人工验证。
- 没有受控测量 Windows GUI 输入延迟或启动性能；构建/打包并发下的启动时间不用于性能比较。
