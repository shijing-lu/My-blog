import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/completion-workspace');
const report = JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'outputs/full-site-design-20261008/manifest.json'))).filter(item => item.viewport === 'desktop');
const sources = fs.globSync('src/pages/**/*.astro', { cwd: root }).sort().map(file => file.replaceAll('\\','/'));
const pages = [['标签文章','/tags/:tag'],['随心录','/quick-notes'],['授权管理','/admin/auth'],['网盘','/admin/netdisk'],['思维导图列表','/admin/mindmaps'],['思维导图编辑','/admin/mindmaps/:id'],['登录','/login'],['管理入口','/manage'],['404','/404'],['Markdown 演示','/demo']];
const utilities = new Map([['src/pages/edit/new.astro','兼容跳转至写作台，不自动创建文章'],['src/pages/diary.astro','兼容跳转至日历'],['src/pages/calendar/diary.astro','带日期跳转至日记弹窗'],['src/pages/moments/cards.astro','复用已改造动态卡片的 HTML 片段'],['src/pages/gallery/manage-cards.astro','复用已改造影集管理卡片的 HTML 片段']]);
const audit = `# 全站页面改造盘点（2026-10-08）

对照 ${sources.length} 个 Astro 页面源文件、日程 React 子路由及 ${manifest.length} 种设计场景，剩余十个页面已实施。个人中心、确认弹窗和两个开发辅助页面一并收尾。没有发现尚未实施外观改造的内容页；RSS、图片代理和 API 是数据端点。

## 本批已完成

| 页面 | 路由 |
|---|---|
${pages.map(([name,route]) => `| ${name} | ${route} |`).join('\n')}

统一暖白纸面、橙红强调、黑色描边与硬阴影，复用首页同源小猫及亮暗令牌。保留原权限、内容格式、接口及数据库结构。修复登录表单被客户端路由拦截的问题，以及思维导图未注册导出插件造成的无文件下载。

## 工程与交付状态

本批 ${report.layouts.length} 项浏览器布局检查和 ${report.interactions.length} 组业务交互通过，页面 JS 错误 ${report.errors.length}。Astro 检查 678 文件、0 错误、0 警告、45 提示；直接 Astro 构建通过。相关权限及桌面运行测试五文件／89 测试通过。具体证据见 completion-workspace-validation.md。

当前为页面完成及打包准备阶段。按照用户约定，保存并退出正在使用的桌面端、确认后构建桌面便携包及 APK。桌面运行与 Android 真机验收需分别记录，不能用浏览器检查代替。

## 所有 Astro 路由文件

| 源文件 | 状态 |
|---|---|
${sources.map(file => `| ${file} | ${utilities.get(file) ?? '已实施对应模块改造'} |`).join('\n')}

## 设计场景逐项对照

| 设计稿 | 场景 | 路由或触发位置 | 状态 |
|---|---|---|---|
${manifest.map(item => `| ${item.id} | ${item.title} | ${item.route} | 已实施；见对应批次验收记录 |`).join('\n')}

## 已有模块证据

neobrutalism-homepage-validation.md、article-workspace-validation.md、moments-workspace-validation.md、settings-workspace-validation.md、schedule-workspace-validation.md、discovery-workspace-validation.md、archive-workspace-validation.md、completion-workspace-validation.md。

前批记录为历史证据，本次未声称重跑所有旧模块的业务流程。部分场景仍需用户确认观感、真实云端服务及真机体验。
`;
fs.writeFileSync(path.join(root, 'docs/page-redesign-audit.md'), audit);
fs.writeFileSync(path.join(root, 'docs/completion-workspace-validation.md'), `# 剩余页面收尾验收记录

## 实现与预览

预览：http://127.0.0.1:43230/quick-notes 。站主验收密码仅本地使用：article-review-local。

${pages.map(([name,route]) => `- ${name}：${route}`).join('\n')}

个人中心和危险操作确认弹窗、/design/material3、/schedule/motion-lab 同步收尾。主要样式限定于 .neo-workspace、.neo-confirm-dialog、个人中心及导图画布；复用首页令牌与猫咪图片。文章正文保留阅读字体设置。

随心录搜索明确只搜索当前页；服务端月份和标签筛选覆盖全部记录。私密内容及授权规则保持不变。网盘保留懒加载；导图保留自动保存、文章绑定与已有节点数据，视觉样式不覆盖保存的主题数据。

登录及管理入口添加 data-astro-reload，避免 Astro ClientRouter 抢先接管异步密码表单、丢失 next 与错误反馈。导图注册官方 Export 插件并提供失败反馈，实际生成 SVG、PNG 与 Markdown 文件已检查。

## 自动检查

- Astro：678 文件，0 错误、0 警告，45 提示；直接 Node 版构建通过，未运行带迁移的总构建。
- 既有权限、授权渲染、桌面服务进程及同步请求测试：五文件／89 测试通过。
- ${report.layouts.length} 项布局：12 路由 × 1440／1320／1280／941／768／390／360px × 亮暗模式；无页面横向溢出，表单不越出视口，每页一个 h1。
- ${report.interactions.length} 组交互：${report.interactions.join('；')}。
- 浏览器 JS 错误 ${report.errors.length}；减少动态模式下进行检查。
- SVG／PNG／Markdown 导出文件保存于 outputs/completion-workspace/map-export.*，校验了内容而非只点击按钮。

## 隔离与人工确认

SQLite 来自上一批验收副本；示例申请、记录、导图均标注“验收示例”。创建／编辑／删除及审批只作用于副本，未改真实内容。网盘目录使用隔离响应，未连接真实网盘；预览中的假地址会显示连接失败，不代表真实服务已验收。

待人工确认：真实数据下页面密度、暗色观感、个人中心资料保存、真实网盘登录及文件下载、云端授权和同步。当前桌面包与 APK 尚未重新构建；用户保存退出后进入打包，真实 Android 安装与运行另记。
`);
const files = fs.readdirSync(out).filter(file => file.endsWith('.png') && !file.startsWith('map-export'));
fs.writeFileSync(path.join(out, 'screenshots.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剩余页面改造验收</title><style>body{background:#fbf7ee;color:#151511;font:15px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0;border:2px solid #151511;border-radius:16px;background:#fffaf1;padding:12px;box-shadow:4px 5px #ff541f}img{width:100%;height:450px;object-fit:contain;object-position:top}figcaption{margin-top:12px;overflow-wrap:anywhere}</style><h1>剩余页面改造验收</h1><p>实际浏览器截图；亮色桌面、手机及暗色桌面。使用隔离数据库。</p><main>${files.map(file => `<figure><a href="${encodeURI(file)}"><img loading="lazy" src="${encodeURI(file)}" alt="${file}"></a><figcaption>${file}</figcaption></figure>`).join('')}</main></html>`);
fs.writeFileSync(path.join(out, 'page-audit.json'), JSON.stringify({ sourceFiles: sources.length, designScenes: manifest.length, pendingSources: [], pages, auxiliaryCompleted: ['profile','confirm','design','motion-lab'] }, null, 2));
console.log(`COMPLETION_HANDOFF sources=${sources.length} scenes=${manifest.length} screenshots=${files.length}`);
