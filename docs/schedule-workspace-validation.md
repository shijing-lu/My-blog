# 日程与日历模块验收记录

本批完成日程总览、计划、时间排期、执行、复盘、待办、统计、日程设置及独立日历和日记弹窗的扁平主义与新粗野主义外观。公共外壳、表单、图表和操作结构沿用现有实现。完成后停在本批人工验收。

## 本地预览

- [日程入口](http://127.0.0.1:43226/schedule)
- [时间排期](http://127.0.0.1:43226/schedule/schedule)
- [日历](http://127.0.0.1:43226/calendar)
- 本地站主密码：`article-review-local`。日程及日记依然仅限站主；日历的重要日期保留公开访问。
- 日程子入口：`/schedule/plans`、`/schedule/execute`、`/schedule/review`、`/schedule/todos`、`/schedule/stats`、`/schedule/settings`。
- 服务器：`scripts/serve-schedule-review.mjs`，端口 43226。SQLite 从上一批设置验收副本复制为 `outputs/schedule-workspace/test.db`。
- 浏览器测试使用全新的临时上下文和隔离 IndexedDB；示例均标明“验收示例”，不会写入日常浏览器的本机日程。用户打开新端口时看到的是该浏览器在此端口保存的本机内容，截图示例不会自动注入。
- 真实日历待办、重要日期和日记 API 的保存仅写入验收副本。本地云端配置也限定在输出目录内。

## 完成内容

- 复用首页视觉令牌、Noto Sans SC 和同源探头猫／趴猫，暖白纸面、橙红标题页签、黑色描边与零模糊硬阴影；明暗模式跟随全站。
- 桌面采用紧凑侧栏，预留右侧公共工具条位置；窄屏保留日程菜单，Esc 关闭与焦点恢复。助手与公共工具条分开定位。
- 总览、计划、专注、复盘、待办、统计和设置通过公共卡片／表单样式统一；保留图表语义颜色和真实统计口径。长计划名最多两行，完整标题保留在按钮的可访问名称与悬停提示中。
- 修复手机计划卡片的网格最小宽度造成的横向溢出；待办列表改为紧凑外层纸面和内部平整行，手机标题、分区与删除操作分行。
- 时间轴在自身区域滚动；手机开始／结束时间控件上下排列。新建／编辑日程、总览新建待办、复盘编辑复用现有 Radix 弹窗，补齐焦点陷阱、Esc 和焦点归还。
- 独立日历采用橙色星期表头、暖白日期格、浅橙选中态和侧面日期纸卡；日记弹窗保留 CodeMirror 编辑器及保存内核，只调整外部面板与标题操作。
- 保留一分钟排期、拖动与拉伸、计划任务、专注计时、复盘、待办坐标、同步及导入导出逻辑。没有修改 API、数据库结构或实际内容，也没有打包／发布。

## 已完成检查

- Astro check：675 个文件，0 errors、0 warnings、43 个既有 hints。
- 7 个相关测试文件，49 项通过：日历、Cadence 外观状态、一分钟排期、事件布局、双数据库模拟及管理员权限／渲染。
- 直接 Astro Node 构建通过；构建器仍提示部分现有分包超过 500kB。未执行数据库迁移的总构建命令。
- Edge Chromium 浏览器：九个页面 × 七种宽度（1440、1320、1280、941、768、390、360px）× 亮暗模式，共 126 组站主布局；另有 14 组游客日历布局和 2 组手机待办列表布局，合计 142 组，无页面级横向溢出。
- 弹窗边界检查 10 组；检查输入框边界、关闭按钮、键盘关闭及菜单焦点恢复。截图在动画完成后采集。
- 最终页脚调整后，另复测 20 组桌面／手机／暗色布局并更新截图；每页只保留公共页脚与首页同款趴猫。结果见 `outputs/schedule-workspace/footer-polish-report.json`。
- 浏览器交互：126 owner route/viewport/mode layouts; mobile menu Esc and focus restoration
- 浏览器交互：minute creation, invalid equal span, keyboard editing, persistence after reload and 24:00
- 浏览器交互：real pointer move and duration resize persisted without changing the domain rules
- 浏览器交互：plan creation and IndexedDB reload
- 浏览器交互：focus start/pause/reload/resume/stop; post-focus review dialog
- 浏览器交互：review slot editing and reload persistence
- 浏览器交互：todo board/list switch and creation
- 浏览器交互：JSON export and import preview; no external synchronization
- 浏览器交互：SPA navigation and history restoration; mobile todo list bounds at 390/360px
- 浏览器交互：real isolated calendar todo/anniversary saves, diary failure retains text, retry, reload and mobile dialog
- 浏览器交互：14 guest calendar layouts; schedule/diary/sync server access denied and private controls absent
- 截图 34 张，未捕获页面 JavaScript 错误；完整机器结果：`outputs/schedule-workspace/browser-report.json`。

## 已知既有问题与人工确认

- 本机一分钟日程创建、编辑、拖拽和刷新恢复已通过。当前 `src/cadence/sync/protocol.ts` 的云端协议仍要求 15 分钟对齐和最小时长 15 分钟（119–120 行）；一分钟记录可能被同步拒绝。这是已有协议与本机规则的差异，本批界面改造没有修改它。
- 本批未执行真实云端同步、主备数据库连接、冲突处理或外部 AI 模型调用；UI 与既有本地数据功能的通过不代表这些外部链路通过。
- JSON 备份导出和导入预览已验证；没有实际覆盖导入或清空回收站。真实备份恢复、同步冲突和助手复杂指令需要人工验收。
- 真实桌面客户端、Android 触摸拖拽、输入法与设备休眠后的计时恢复仍需设备验收；没有重新打包客户端。
- 请人工确认时间轴密度、长内容阅读、手机按钮和明暗配色；本批停在验收，不继续改造其他模块。

## 截图与复现

- 截图索引：`outputs/schedule-workspace/screenshots.html`。
- 启动预览：`rtk node scripts/serve-schedule-review.mjs`。
- 回归：`rtk node scripts/verify-schedule-workspace.mjs`。
