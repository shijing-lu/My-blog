import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/archive-workspace');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'outputs/full-site-design-20261008/manifest.json'))).filter(item => item.viewport === 'desktop');
const pendingIds = new Set(['10-tags', '11-quick-notes', '20-auth', '22-netdisk', '23-mindmaps', '24-map-editor', '46-login', '47-manage', '48-manage-visitor', '49-manage-admin', '50-not-found', '51-demo']);
const pendingSources = new Set(['tags/[tag].astro', 'quick-notes.astro', 'admin/auth.astro', 'admin/netdisk.astro', 'admin/mindmaps.astro', 'admin/mindmaps/[id].astro', 'login.astro', 'manage.astro', '404.astro', 'demo.astro']);
const utilities = new Map([['edit/new.astro','兼容跳转：/edit/new → /edit，不自动创建文章'], ['diary.astro','兼容跳转：/diary → /calendar'], ['calendar/diary.astro','带日期跳转到日历日记弹窗'], ['moments/cards.astro','HTML 片段：复用已改造动态卡片'], ['gallery/manage-cards.astro','HTML 片段：复用已改造影集管理卡片']]);
const sources = fs.globSync('src/pages/**/*.astro', { cwd: root }).sort().map(file => file.replaceAll('\\','/').replace('src/pages/',''));
const report = JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json')));
const empty = JSON.parse(fs.readFileSync(path.join(out, 'empty-report.json')));
const state = id => pendingIds.has(id) ? '待改造：内部仍是旧版布局与控件' : id === '53-profile' ? '公共弹窗外壳已统一；个人资料内部待专项收尾' : ['45-motion-lab','52-design'].includes(id) ? '开发辅助：沿用统一令牌／外壳，未做专项视觉验收' : ['62-confirm','63-boundaries'].includes(id) ? '已完成模块有检查记录；剩余模块仍需同步' : '已实施；见对应模块验收记录';
const audit = `# 全站页面改造盘点（2026-10-08）

本次完成归档后，对照 ${sources.length} 个 Astro 路由文件、日程 React 子路由和 ${manifest.length} 种设计场景检查。这里的“待改造”指新粗野主义界面尚未落地，不代表原有业务功能不能使用。公共导航、颜色和页脚已换肤，不能据此认定页面内部已完成。

## 打包条件

**仍有未完成页面，用户约定的“全部完成再构建桌面端与 APK”条件未满足。** 本批仅做工程检查和本地 Astro 预览构建，没有覆盖运行中的桌面客户端，没有构建 APK，也没有发布。待页面收尾及验收完成，先提醒用户保存内容并退出桌面端，收到确认后再执行桌面打包和 APK 构建。

## 待完成的实际页面

| 页面 | 路由 | 证据与剩余内容 |
|---|---|---|
| 标签文章 | /tags/:tag | 旧网格与文章卡，缺少新标题、纸面描边、统一空态 |
| 随心录 | /quick-notes | 独立记录页仍为浅边框列表和旧筛选栏；编辑浮窗已随公共组件改造 |
| 授权管理 | /admin/auth | 原权限申请、管理员列表与表单仍为旧布局 |
| 网盘 | /admin/netdisk | 文件树外框、状态说明及工具按钮待改造；设置中的网盘对接已完成 |
| 思维导图列表 | /admin/mindmaps | 新建表单与列表仍为旧版；保留原功能 |
| 思维导图编辑 | /admin/mindmaps/:id | 工具栏及画布控件未按设计稿收尾 |
| 登录 | /login | 内部表单仍是旧版，公共导航与模式令牌已统一 |
| 管理入口 | /manage | 未登录、访客申请、普通管理员三种状态尚未改造；站主继续跳转授权管理 |
| 404 | /404 | 内部提示与返回按钮仍是旧版 |
| Markdown 演示 | /demo | 开发辅助页，仍用旧正文与目录外壳，未改造 |

另需收尾或专项确认：个人中心弹窗内部；/schedule/motion-lab 与 /design/material3 两个开发辅助界面。后两者已有统一令牌或纸面组件，不能当成已经通过完整页面验收。跨页确认、加载和失败状态应在剩余模块改造时一并检查。

已对上述业务页面进行源码核对，并取得 ${report.audit.length} 个真实浏览器只读截图（思维导图详情取验收副本中现有记录）。没有执行授权、网盘远程操作、导图编辑或用户内容写入。

## 所有 Astro 路由文件

| 源文件 | 状态 |
|---|---|
${sources.map(file => `| src/pages/${file} | ${pendingSources.has(file) ? '待内部改造' : utilities.get(file) ?? (file === 'design/material3.astro' ? '开发辅助：已有新令牌与纸面组件，待专项验收' : file === 'schedule/[...path].astro' ? '日程八个业务子页已完成；motion-lab 为开发辅助页' : '已实施对应模块改造')} |`).join('\n')}

RSS、图片代理和 /api/* 是数据端点，未当作待设计的内容页。访问不存在的文档／文章／导图的跳转保持原路由行为。

## 设计场景逐项对照

| 设计稿 | 场景 | 路由或触发位置 | 状态 |
|---|---|---|---|
${manifest.map(item => `| ${item.id} | ${item.title} | ${item.route} | ${state(item.id)} |`).join('\n')}

## 完成模块的已有证据

- 首页和公共外壳：docs/neobrutalism-homepage-validation.md
- 文章、文档、写作及管理：docs/article-workspace-validation.md
- 动态：docs/moments-workspace-validation.md
- 设置（包含同步、十个分区及 site-css 兼容说明）：docs/settings-workspace-validation.md
- 日程、日历、日记：docs/schedule-workspace-validation.md
- 导航和影集：docs/discovery-workspace-validation.md
- 本批归档：docs/archive-workspace-validation.md

历史记录是前批检查证据，本次未声称重跑了每个已完成模块的业务测试。实际桌面端与 Android 客户端仍须在最终打包后验收。
`;
fs.writeFileSync(path.join(root, 'docs/page-redesign-audit.md'), audit);
const validation = `# 归档页面验收记录

## 预览和实现

- 本地预览：http://127.0.0.1:43228/archive
- 样式仅作用于 .neo-archive，复用首页亮暗令牌、Lucide 及 cat-peek.webp，页脚继续复用公共趴猫。
- 暖白文章卡、黑色描边、橙色时间轴和选中按钮，日期采用原统计口径的北京时间；不读取正文来找封面。
- 桌面独立筛选栏、窄屏折叠筛选区和分类局部滚动；预留公共工具条位置。
- 保留标签／分类互斥、点击同一条件取消、文章链接、阅读量及加密状态。筛选后的年月分组计数显示实际命中篇数，空分组隐藏。
- 仅改归档界面及本地验收脚本，未修改 API、内容类型或数据库结构。

## 自动检查

- Astro 检查：677 文件，0 错误、0 警告；43 个现有提示。
- 原有时间线、路由权限、新外观状态及 API 测试：4 文件／102 测试通过。
- 直接 Astro Node 构建通过；保留既有大于 500kB 的分块体积提示。没有使用会触发数据库迁移的总构建命令。
- 浏览器：${report.layouts.length} 项布局检查（七宽度 × 亮暗模式，加站主 941／390），无页面横向溢出；工具条不覆盖文章卡。
- ${report.interactions.length} 项交互：${report.interactions.join('、')}。
- 空文章数据库：${empty.length} 个宽度通过；长标题、未命名文章、跨年跨月、未分配分类、零篇分类、加密标签在本地副本检查。
- 页面 JS 错误：${report.errors.length}。访客归档条目不提供管理操作。

## 隔离和边界

主验收库 outputs/archive-workspace/test.db 从上一批验收副本复制，追加九条明确标注的归档示例；无文章检查使用另外的 empty.db 和临时服务器，检查结束已关闭。未改实际文章／导图／授权，也未接入真实云端图库凭据。预览站主密码仅本地使用：article-review-local。

本批留下公开只读预览与截图。真实桌面和 Android 客户端未打包／验收。全站仍有待改造页面，详见 docs/page-redesign-audit.md。

人工确认：归档密度、日期与文章信息排列、手机右侧工具条留白、暗色观感；生产数据大量标签情况下的筛选栏使用感受。
`;
fs.writeFileSync(path.join(root, 'docs/archive-workspace-validation.md'), validation);
const files = fs.readdirSync(out).filter(file => file.endsWith('.png'));
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>归档验收与剩余页面截图</title><style>body{background:#fbf7ee;color:#151511;font:15px system-ui;margin:24px}h1{font-size:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0;border:2px solid #151511;border-radius:16px;background:#fffaf1;padding:12px;box-shadow:4px 5px #ff541f}img{width:100%;height:450px;object-fit:contain;object-position:top}figcaption{margin:12px 0 2px;overflow-wrap:anywhere}a{color:#c6370c}</style><h1>归档验收与剩余页面截图</h1><p>归档为本批完成页。audit- 开头的截图记录待改造页面，不能作为完成效果。截图使用隔离数据库。</p><main>${files.map(file => `<figure><a href="${encodeURI(file)}"><img loading="lazy" src="${encodeURI(file)}" alt="${file}"></a><figcaption>${file}</figcaption></figure>`).join('')}</main></html>`;
fs.writeFileSync(path.join(out, 'screenshots.html'), html);
fs.writeFileSync(path.join(out, 'page-audit.json'), JSON.stringify({ sourceFiles: sources.length, designScenes: manifest.length, pendingSources: [...pendingSources], scenes: manifest.map(item => ({ ...item, status: state(item.id) })) }, null, 2));
console.log(`ARCHIVE_HANDOFF sources=${sources.length} scenes=${manifest.length} pendingPages=${pendingSources.size} screenshots=${files.length}`);
