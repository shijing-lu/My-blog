# Material 3 覆盖矩阵

本轮 1.1.1 设置和公共控件修复的专项矩阵，以及最终构建完整重跑 1500 个组合的结果，见 [显示修复验收](display-repair-verification.md)。下表的业务操作边界仍有效，不把布局采样等同于全部业务状态已操作。

更新日期：2026-10-05。以下区分页面检查、业务状态回归、模拟接口测试和真实运行环境验收。“页面检查通过”仅表示该次访问的 HTTP、主题根属性、明暗模式、字体、页面宽度及脚本检查通过，不表示该页面的全部业务操作已通过。尚未逐项人工检查的交互状态保留在“待补验”列。

## 自动化检查结果

| 检查 | 实际结果 | 证据与范围 |
|---|---|---|
| 全页面矩阵 | 50 个页面/入口 × 30 组合，共 1500 次访问；原始记录 1494 次通过、6 次选择框溢出 | [coverage.json][full] 的 `pages`、`failures`；42 个 Astro 源页面含重定向入口，另加 8 个 Cadence 子路由。部分入口落地到同一页面，不能理解为 50 个不同渲染页面 |
| 修复后的思维导图管理页 | 最终构建 `/admin/mindmaps` 30/30 组合通过，原 6 个经典风格小屏溢出均消失 | [coverage-targeted.json][targeted]：`routeFilter=/admin/mindmaps`，`failures/errors/consoleErrors/mutations=[]` |
| 最终有效页面矩阵 | 保留其他 49 个入口的 1470 次有效结果，加修复后该入口 30 次结果，合计 1500/1500 | [coverage-final-summary.json][summary] 的 `effectiveRouteCoverage`；保留原失败证据，未重写原报告，也未声称最终构建重新跑过全部 1500 次 |
| 原页风格/明暗/宽度切换 | 首页、文档、日程、设置共 120/120 次通过 | [coverage.json][full] 的 `matrix`：4 个代表页 × 两种风格 × 三种明暗设置 × 五种宽度，在同一页面实例切换 |
| 系统主题及键盘交互 | 21/21 项通过 | [coverage.json][full] 的 `interactions`：16 项系统明暗实时变化、4 项日程待办弹窗焦点/Tab/Shift+Tab/Escape、1 项共享 Radix 选择器/菜单/弹窗组合检查 |
| 最终构建追加 console 检查 | 全 50 个入口 × 3 个代表组合，150/150 次通过；页面异常、console 错误、溢出及被拦截写入均为 0 | [coverage-console.json][console]：Material 明亮 390、Material 暗色 1280、经典明亮 1280；没有将 console 检查扩写为全部 30 组合 |
| 编辑与设置状态 | 2 个真实编辑器、3 个阅读入口、4 项设置状态、4 项全局状态通过，`errors=[]` | [editor-verification.json][editor]；隔离数据库内 7516 字符测试正文，具体状态见下表 |
| 相册与加密阅读 | 两种风格均完成指定状态测试，`browserErrors=[]` | [media-gate-verification.json][media]；相册请求使用模拟响应，加密文章使用隔离测试数据，具体边界见下表 |
| 单元/集成测试 | 70 个测试文件、921 个测试通过 | [unit-tests.log][unit]；数据库模拟、SQLite 接口、同步核心及权限测试与真实云端探测分别记录 |
| 唯一临时 settings 记录的真实云同步 | 6 次真实 runSync 成功；Material/经典各上传 1 条、另一隔离本地库拉取 1 条，两次重复同步均 0 变更；主备 4 次值/毫秒时间戳核对通过，清理后 2/2 不存在 | [settings-sync.json][settings-sync]；隔离 SQLite A/B 与真实主备 PG，精确限制唯一临时 key，未访问真实 `ui_style`、用户行或实际桌面数据库 |
| 最终正式站只读检查 | 12/12 组合通过：两种风格 × 390/1280px × 首页/文档库/设计样页；首帧风格正确，Material 包内中英文字体及图标加载，无页面溢出、运行错误或内容写入；访客修改设置返回 401 | [production-verification.json][production] 的 `pages/defaultStyle/visitorWriteStatus/errors/writes`；实际站点默认仍为 classic |
| 已安装桌面客户端 | 实际运行的白衣卿相 1.1.0 / Electron 44.3.0，双风格即时切换；切换期间外观面板保持打开，字体就绪后 Material 使用 Roboto；无页面溢出、运行错误或内容写入，测试后恢复原设备偏好 | [desktop-verification.json][desktop] 的 `userAgent/styles/errors/writes/preferenceRestored`；[desktop-check.log][desktop-log] 与 [CDP 验证脚本][desktop-script] |
| 最后设计修正的浏览器补验 | 5 个样本通过：390/1280px 日程 FAB 间隔 46px，打开助手时隐藏工具按钮、关闭后恢复；390px 文档树限高 280px 并局部滚动，页面无溢出；12 个快捷笔记编辑工具在两种宽度均为 48×48px | [final-design-check.json][final-design] 的 `samples/errors/writes`，`errors/writes=[]`；触控为浏览器 coarse 模拟，不是真机 |

30 组合指 `classic/material3` × `light/dark/system` × `320/390/768/1280/1920px`。页面矩阵中的 system 使用模拟系统暗色；代表页另有实时切换到系统明亮和暗色的 16 项检查。浏览器上下文启用了减少动态效果，未逐项验收所有普通动效。

原完整报告完成于 2026-10-04 20:09（北京时间）；最终构建目标页补验完成于 2026-10-05 00:19，console 补验同在 00:19 完成。原 6 个失败均为 `select#map-article` 长选项导致经典风格在 320/390px 下撑宽，分别覆盖三种明暗设置；补验保留可追溯记录。

## 模块与业务状态

报告定位使用 JSON 字段或页面 `source`，可区分“已打开页面”与“执行过操作”。下面所有页面检查均包含两种风格的 30 组合；业务状态仅列已实际执行并断言的项目。

| 模块 | 已实际验证 | 报告定位 | 待补验的业务或交互状态 |
|---|---|---|---|
| 全局导航与外观面板 | 所有入口的根风格、明暗、字体与宽度；访客首帧；当前设备覆盖；跨标签页 storage 事件；系统明暗实时变化；窗口重新聚焦后刷新站点默认；动态自定义 CSS 在 Material 下停用、切回恢复 | [full] `pages/matrix/interactions`；[editor] `settings/state`；[isolated] `pages/visitorWriteStatus` | 搜索建议的选择与错误；每个全局面板的鼠标、触控、焦点返回及不同权限入口；所有导航转场状态尚未逐项人工复核 |
| 公开页面 | 首页、归档、标签、网址导航、登录、404、demo 与设计系统展示页的访问及布局检查 | [full] `pages[].source`：`index.astro`、`archive.astro`、`tags/[tag].astro`、`nav.astro`、`login.astro`、`404.astro`、`demo.astro`、`design/material3.astro` | 搜索/筛选实际结果、各页面空数据与接口错误、登录错误/限流/不同授权角色未逐项覆盖 |
| 文章阅读与编辑 | 公开文章及文章编辑入口中的阅读；二级正文标题折叠在换肤后保留；两种风格下加密正文未解锁时不暴露源文、错误密码提示、正确密码解锁、刷新保持外观、折叠及手机无横向溢出；文章编辑器光标、EditorView 身份、折叠、撤销和完整源文自动保存保留 | [full] `blog/[slug].astro`、`edit/index.astro`、`edit/new.astro`、`edit/[id].astro`；[editor] `reading/editing[page=home-editor]`；[media] `encryptedReading` | 新建入口不产生空文章、删除/权限及复杂文章逐篇编辑；H1–H6 均在测试源文中，但此次换肤浏览器回归只明确操作 L2 折叠，不能写为六级标题逐级人工验收 |
| 文档库与正文 | 文档库及指定真实文档节点的布局；文档阅读 L2 折叠保留；就地编辑器换肤不重建，光标、撤销、折叠及完整自动保存保留；编辑状态五种宽度无页面横向溢出；390px 下文档树高度/max-height 280px、scrollHeight 1754px、overflow-y auto，页面宽度 390px | [full] `doc.astro`、`doc/[id].astro`；[editor] `reading[doc-reading]`、`editing[page=doc-editor]`；[final-design] `samples[name=document-mobile-local-tree]` | 文档树新增/移动/删除、逐节点展开/收起、目录跳转历史及延迟节点的全部状态仍待逐项验证；限高与局部滚动已有实测，不再列为待验 |
| Markdown 与编辑扩展 | 7516 字符正文含 H1–H6、提示块、分栏、代码、公式、表格；换肤与自动保存后源文完整，编辑器五种宽度检查通过 | [editor] `fixtures.sourceCharacters/editing`；[测试脚本][editor-script] `fixtureSource` | 每个工具栏按钮、右键菜单、快捷键、插入/导出及每种扩展的 hover/focus/pressed/disabled/loading/error 尚未逐项业务验收；出现于测试正文不等于扩展全部功能通过 |
| 相册 | 列表与上传页布局；两种风格中选框获得焦点和鼠标悬停时多图片粘贴进入队列；切换保留待上传队列；普通文本输入和纯文本粘贴不被劫持；压缩后的 JPEG 载荷、进度、失败汇总及重试 | [full] `gallery/index.astro`、`gallery/upload.astro`；[media] `gallery`、`clipboardMethod` | 上传为渲染页上的 ClipboardEvent + 真实图片文件，10 次请求使用 mock 网络响应；未操作系统剪贴板，未验证真实图床/云存储写入、服务端鉴权及清理；灯箱、分类、卡片删除/管理待逐项验证 |
| 动态 | 列表与真实详情页面的访问、主题及宽度；修复长代码导致移动列表撑宽，正文代码保留局部滚动 | [full] `moments/index.astro`、`moments/[id].astro` | 展开、编辑、删除、可见性权限、空数据和媒体外围控制尚未逐项执行；`moments/cards` 为 partial 片段，没有被当作独立页面计数 |
| 日历与日记 | 日历页以及 `/calendar/diary`、`/diary` 重定向入口的落地页检查 | [full] `calendar/index.astro`、`calendar/diary.astro`、`diary.astro` | 日期切换、添加/完成/删除待办、日记保存与打卡状态待逐项业务验证 |
| 日程 Cadence | 主入口及 plans/schedule/execute/review/todos/stats/settings/motion-lab 全部页面检查；全局风格/明暗跟随；代表页实时系统明暗；待办弹窗打开后焦点进入、正反 Tab 不逸出、Escape 关闭；390/1280px coarse 模拟中总览加载，工具/助手 FAB 为 56/52px、间隔 46px，打开助手隐藏工具、关闭恢复 | [full] `schedule/[...path].astro`、`source=cadence/*`、`interactions[name=todo-modal-*]`；[Cadence 外观测试][cadence-appearance-test]；[final-design] `samples[name=schedule-FAB-and-loaded-overview]` | 添加/完成/删除任务、项目与复盘、计时恢复、统计数据及 AI 助手真实调用未逐项回归；没有把九个页面打开成功写成全部日程业务通过 |
| 管理 | 管理首页、授权、思维导图列表/编辑、导航与网盘的页面检查；思维导图列表原生选择框最终构建全 30 组合无溢出 | [full] `source=admin/index.astro/admin/auth.astro/admin/mindmaps*.astro/admin/nav.astro/admin/netdisk.astro/manage.astro`；[targeted] `pages` | 导图增删、绑定文章、图形编辑/导出，授权变更、网盘连接及管理确认/错误状态待逐项验证；用户创作的导图内容不改写 |
| 设置 | 全部设置分区页面检查；站点默认保存成功、模拟失败恢复原选择、访客 SSR 首帧、设备明确选择在刷新后优先；公开 GET 与访客修改被拒绝；API 非法值/权限/失败持久化有测试 | [full] `source=admin/settings*.astro`；[editor] `settings`；[isolated] `visitorWriteStatus=401`；[UI API 测试][ui-api-test] | 站名、名言、落地页、图床、Markdown CSS、全站 CSS、AI、网盘、同步及快捷键的每个保存/失败/禁用状态尚未逐项业务执行；数据库与同步证据见下一节 |
| 公共控件与反馈 | 真实共享 Radix Select 下拉选择、Dropdown 菜单及 Dialog 的 Escape；待办弹窗焦点约束；相册进度/失败/重试提示；设计样页工具栏及导航触控尺寸，checkbox/radio/switch 视觉框外命中并切换；390/1280px coarse 模拟下快捷笔记编辑器 12 个工具按钮均为 48×48px | [full] `interactions[name=shared-Radix-select-menu-dialog]`；[media] `gallery`；[design] `touch`；[final-design] `samples[name=quick-note-editor-toolbar-coarse-size].icons` | Toast、确认窗、AI、快捷笔记完整业务、Twikoo 及各模块异步插入内容尚未逐个状态人工复核；实测工具栏与设计样页不代表所有控件，正文行内控件例外保留 |

首页、文档、日程和设置保存了双风格 390/1280px 的截图，定位于 [full] `matrix[].screenshot`；另有 32 张明暗对照样本及视觉评审说明：[design-audit.json][design]、[visual-review.md](visual-review.md)。视觉评审记录包含当时尚待复核项，不能因几何检查通过便自动将每张截图标为视觉通过。配色角色的 22 项对比度审计见 [palette-audit.json][palette]，最小为明亮 6.45:1、暗色 7.20:1；它仅覆盖固定角色配对。

## 数据库与同步

| 层次 | 实际验证与状态 | 证据 | 尚未证明的范围 |
|---|---|---|---|
| SQLite 与 UI 设置接口 | 隔离本地数据库站点默认读写及编辑自动保存通过；`ui_style` 沿用 settings KV。UI API 测试使用两份 SQLite，验证相同时间戳镜像 upsert、非法值 400、权限、失败保留旧值和读失败 500 | [editor] `settings/editing`；[ui-api-test]；[unit] 70 文件/921 测试通过 | 两份 SQLite 测试不是实际 PostgreSQL 连接；不代表真实桌面重启后的持久化验收 |
| 真实主备 PostgreSQL | Vercel 构建中的 live probe：主备各 36 表验证、0 列新增；settings KV upsert/read mirror 与 fallback 通过；ORM 镜像 insert/update/delete/returning、时间戳在两个 endpoint 通过；失效主库时备库 read/write 通过；Cadence CAS revision/tombstone mirror 与 fallback 通过 | [vercel-inspect.log][cloud-log] 的 `[deployment-schema]` 与 `[cloud-db-check]`；[探测脚本][cloud-script] | 探针使用唯一临时 key/记录并 cleanup，未改真实 `ui_style`；这是部署期间的数据库探测，不能替代正式站全部编辑业务或真实设备同步 |
| 同步核心与冲突策略测试 | 同步引擎、SQLite/PG endpoint、settings 注册及 Cadence 主备 revision/冲突/tombstone 已有单元/集成测试通过 | [unit]；[sync-engine 测试][sync-test]；[Cadence 双库测试][cadence-db-test] | 此处 mock/内存数据及本地测试与 live PG 探测、下一行实际同步分开；没有通过单测结果推断真实设备端到端同步 |
| 唯一临时 settings 记录的实际同步 | 真实 runSync、LocalSyncStore、SqliteEndpoint 与 PgEndpoint；Material 和经典分别完成隔离 SQLite A → 主备 PG → 隔离 SQLite B。4 次上传/拉取各处理 1 条，2 次重复同步均无变更；4 次主备核对值及毫秒时间戳一致；25 项越界拒绝自检；主备清理后 2/2 不存在，隔离本地也已清理 | [settings-sync] 的 `status=passed`、`phases`、`endpointChecks`、`guardRejections`、`cloudCleanup`、`isolatedLocalCleanup`，执行于 2026-10-05 00:34（北京时间） | 只允许唯一临时 settings key；`actualUiStyleAccessed/userRowsRead/actualDesktopDatabaseOpened/cloudMetadataWritten=false`。没有操作用户实际 `ui_style` 或文章数据，也没有证明真实两台设备的冲突、离线恢复和全量同步业务 |

## 运行环境验收

| 环境 | 当前实测状态 | 待最终记录 |
|---|---|---|
| 隔离浏览器 | Edge headless + 本地独立端口/数据库副本；页面矩阵、编辑与设置、媒体状态以及 console 补验已记录 | 视口模拟不是原生客户端/Android 真机；没有将浏览器检查计为下面两项通过 |
| 正式网站 | 最终部署已 Ready 并 Promote 至 [www.byqx-blog.online](https://www.byqx-blog.online)，部署 ID `dpl_7CYgwXniWAD6nK7dXegofvvHNygz`。12/12 只读检查通过：两种风格、390/1280px、首页/文档库/设计样页；首帧正确，Roboto/Noto Sans SC/Material Symbols 包内字体加载，无页面溢出、运行错误及内容写入；访客设置修改被拒绝，默认 classic | [最终部署日志][deploy-final]、[production] `pages/visitorWriteStatus/errors/writes`。此轮正式站检查未包含登录后的编辑、管理、全部明暗组合或断网全功能验收，不扩写为这些业务已通过 |
| 真实桌面客户端 | 已安装并运行白衣卿相 1.1.0，User-Agent 确认 Electron 44.3.0；经真实窗口 CDP 验证 Material/经典即时切换，面板保持打开；字体 ready 后 Material 为 Roboto；1424px 窗口下文档宽度 1409px，无横向溢出；`errors/writes=[]`、`preferenceRestored=true` | [desktop]、[desktop-log]、[desktop-script]，截图 `desktop-installed-material3.png` / `desktop-installed-classic.png`。本次检查覆盖已安装窗口及换肤，不包含客户端启动耗时基准、重启后偏好持久化、实际桌面数据库编辑/云同步或断网全功能验收 |
| Android WebView | 用户已确认先交付安装包，真机验收后续完成；真机状态仍待验证 | APK 构建/签名与真机运行分别填写；系统返回、旋转、文件授权、剪贴板和导航不能以浏览器模拟代替 |

## 验证边界

- 全页面与 console 检查阻止 PUT/PATCH/DELETE，未触发被阻止的写入；编辑、设置及加密阅读测试只修改隔离副本/临时数据。正式生产库探测只使用临时记录并清理。
- 页面矩阵主动阻止外部媒体请求，忽略测试控制的 `ERR_BLOCKED_BY_CLIENT` 和预期 404 页面资源错误；没有据此声称外部图片/视频的真实网络加载通过。
- 系统文件选择/授权与第三方视频 iframe 内部由其自身界面控制。正文媒体和用户绘制图表保持原数据；应用工具栏与外围容器纳入 Material。
- 当前页面矩阵主要为桌面浏览器改变宽度；设计审计的 `coarse=true` 是独立触控模拟。[final-design] 已实测 390/1280px 快捷笔记工具栏 12 个按钮的 48×48px 尺寸、日程两个 FAB 的 46px 间隔及助手面板打开/关闭时工具隐藏/恢复，并实测 390px 文档树 280px 限高与局部滚动。此证据只覆盖这些样本，不能扩大为所有控件或真实触控状态均通过；正文任务框、行内复制和 CodeMirror 折叠占位仍保留行内几何例外，见 [设计规范](design-system.md)。

[full]: ../../outputs/material3-review/coverage.json
[targeted]: ../../outputs/material3-review/coverage-targeted.json
[console]: ../../outputs/material3-review/coverage-console.json
[summary]: ../../outputs/material3-review/coverage-final-summary.json
[editor]: ../../outputs/material3-review/editor-verification.json
[media]: ../../outputs/material3-review/media-gate-verification.json
[isolated]: ../../outputs/material3-review/isolated-verification.json
[design]: ../../outputs/material3-review/design-audit.json
[palette]: ../../outputs/material3-review/palette-audit.json
[unit]: ../../outputs/material3-review/unit-tests.log
[cloud-log]: ../../outputs/material3-review/vercel-inspect.log
[editor-script]: ../../scripts/verify-material3-editor.mjs
[cloud-script]: ../../scripts/verify-cloud-databases.mts
[ui-api-test]: ../../tests/ui-style-api.test.ts
[cadence-appearance-test]: ../../tests/cadence-site-appearance.test.ts
[cadence-db-test]: ../../tests/cadence-dual-database.test.ts
[sync-test]: ../../tests/sync-engine.test.ts
[settings-sync]: ../../outputs/material3-review/settings-sync.json
[production]: ../../outputs/material3-review/production-verification.json
[deploy-final]: ../../outputs/material3-review/vercel-deploy-final.log
[desktop]: ../../outputs/material3-review/desktop-verification.json
[desktop-log]: ../../outputs/material3-review/desktop-check.log
[desktop-script]: ../../scripts/verify-material3-desktop.mjs
[final-design]: ../../outputs/material3-review/final-design-check.json
