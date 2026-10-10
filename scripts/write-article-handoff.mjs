import fs from 'node:fs';import path from 'node:path';
const out=path.resolve('outputs/article-workspace'),f=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8'));
const base='http://127.0.0.1:43223';
const routes=[['文档库','/doc'],['大量目录文档',`/doc/${f.bundle}?article=${f.first}`],['写作台','/edit'],['文章编辑',`/edit/${f.articles.tech.id}`],['文章管理','/admin'],['技术文章',`/blog/${f.articles.tech.slug}`],['笔记文章',`/blog/${f.articles.note.slug}`],['摄影文章',`/blog/${f.articles.photo.slug}`],['密码保护',`/blog/${f.locked.slug}`]];
const links=routes.map(([title,route])=>`- [${title}](${base+route})`).join('\n');
const screenshots=fs.readdirSync(out).filter(name=>name.endsWith('.png')&&!name.startsWith('inspect')).sort();
const validation=`# 文章与文档模块验收 · 2026-10-08

本批完成 /doc、/doc/:id、/edit、/edit/new、/edit/:id、/admin 和公开文章技术/笔记/摄影/密码保护界面的改造。首页同源探头猫用于标题、文档库空态，公共页脚继续沿用首页趴猫。主要外壳采用暖白纸面、橙色强调、黑色描边与硬阴影；阅读区和 CodeMirror 内核保持已有排版、原地编辑及内容配置。

## 本地预览

${links}

需要管理权限时：[登录本地预览](${base}/login)，口令 article-review-local。密码保护示例的访问口令是 review-pass-2026。这些口令只用于独立本地验收服务。

数据路径：outputs/article-workspace/test.db。从之前的验收副本只读备份；测试新增与编辑只发生在此副本。没有修改实际数据库、公共 API、数据库结构或内容类型，没有运行迁移或发布、客户端打包。

## 目录与交互

- 桌面左目录 220px、右目录 240px、间距 16px；1320px 以上右目录占独立栏位。其余尺寸保留右侧浮层，手机左目录可折叠。
- 普通桌面行 32px、13px 字号、每级缩进 12px；长标题最多两行，悬停与键盘聚焦显示完整标题。手机目录操作行至少 44px。
- 左右目录各自滚动，外层顶栏固定，滚动边界不带动正文。现有目录展开/滚动恢复逻辑继续使用；没有增加虚拟列表、目录搜索或自动折叠。
- 右浮层具有遮罩、Esc 关闭、焦点循环与返回；原生设置/搜索弹窗优先处理键盘输入。
- 正文自动保存显示待保存、正在保存、已保存及失败状态；保存失败提供“重新保存”，不改 CodeMirror 保存队列。
- /edit/new 保留带 parent 参数的重定向，访问页面不自动创建文章。公开文章不增加私有左文章树。

## 自动化证据

- Astro check：674 文件，0 errors、0 warnings、43 hints（已有未使用变量/弃用签名等提示）。
- 相关既有测试：12 文件、186 项通过，覆盖目录渲染、文档查询、保存队列、密码门禁、文章状态、主题、权限及标题折叠/索引。
- 直接 Astro Node 构建成功；未运行包含数据库迁移的总 build。保留大于 500kB 的现有前端包体提示。
- [布局报告](../outputs/article-workspace/browser-report.json)：9 个页面/状态 × 7 宽度 × 2 模式，共 126 组；1440、1320、1280、941、768、390、360px 无页面级横向溢出，旧风格存储不会恢复旧外观。
- 密集目录初始夹具为 302 个左节点（296 篇、六层目录），200 个右章节。后续导入在副本内添加示例文章；验证行高、标题提示、折叠、独立滚动和右目录不遮正文。
- [阅读报告](../outputs/article-workspace/reading-browser.json)：文章切换、前进后退、折叠/黑幕状态恢复、正文与全局搜索、原地编辑输入和独立文章编辑入口，四组通过。
- [编辑报告](../outputs/article-workspace/editing-report.json)：模拟保存故障与重试、保存反馈、返回阅读、下载最新 Markdown、HTML5 拖拽事件链保存移动、Markdown 文件拖入、管理弹窗及密码错误/正确解锁，六组通过。
- 游客没有文档管理控件，受保护文章未解锁时服务器不返回正文、不显示导出；右目录在窄屏支持键盘、遮罩和焦点恢复。

## 图稿与截图

- [本批校正设计图](../outputs/article-workspace/design/index.html)：23 张 PNG/SVG，猫咪直接嵌入首页同源素材；包含1440/941/390px 的紧凑目录示例。猫咪本身是嵌入的 WebP，不是重新绘制的 SVG。
- [截图索引](../outputs/article-workspace/screenshots.html)：实际浏览器截图，覆盖关键页面桌面、手机与暗色，以及保存失败/保存成功、管理弹窗。
- [桌面文档](../outputs/article-workspace/doc-1440-light.png)、[手机文档](../outputs/article-workspace/doc-390-light.png)、[暗色文档](../outputs/article-workspace/doc-1280-dark.png)。

## 待人工确认

视觉观感与真实长文阅读/编辑位置连续性由你验收。自动化已验证拖拽事件链与移动落库，真实鼠标/触摸拖拽手感仍需人工检查。浏览器采用 Edge headless；没有把浏览器尺寸模拟算作真实 Electron 桌面或 Android 客户端验收。

AI 编辑内核未改；没有调用付费模型，需你按真实模型配置验证实际 AI 修改。PDF 导出的打印布局、讨论区的真实 GitHub 登录/发送，以及用户自定义复杂字体/正文样式的最终观感也留给人工验收。

停在本批验收，不继续导航管理、影集、思维导图编辑、网盘、授权、设置或日程模块，不发布网站、不重新打包客户端。

## 复现

直接运行 DESKTOP=1 node node_modules/astro/bin/astro.mjs build（PowerShell 先设置 $env:DESKTOP）。node scripts/serve-article-review.mjs 启动隔离副本。首次需要示例时运行 node scripts/seed-article-review.mjs，避免重复生成夹具。浏览器检查分别是 verify-article-workspace.mjs、verify-article-reading.mjs 和 verify-article-editing.mjs。
`;
fs.writeFileSync('docs/article-workspace-validation.md',validation);
fs.writeFileSync(path.join(out,'README.md'),`# 本批验收入口\n\n${links}\n\n管理登录口令：article-review-local；保护文章口令：review-pass-2026。所有操作只写独立 test.db。\n\n[验收记录](../../docs/article-workspace-validation.md) · [截图](screenshots.html) · [校正设计图](design/index.html)\n`);
fs.writeFileSync(path.join(out,'screenshots.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><title>文章文档实际截图</title><style>body{font-family:system-ui;background:#fbf7ee;color:#151511;padding:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}img{width:100%;border:2px solid;border-radius:14px}a{color:#c6370c}h2{font-size:15px}</style><h1>文章与文档 · 实际浏览器截图</h1><p>本地隔离数据；桌面、手机、暗色及关键弹窗状态。</p><p>${routes.map(([title,route])=>`<a href="${base+route}">${title}</a>`).join(' · ')}</p><main>${screenshots.map(name=>`<section><h2>${name}</h2><a href="${name}"><img src="${name}" alt="${name}" loading="lazy"></a></section>`).join('')}</main></html>`);
console.log('Wrote handoff with '+screenshots.length+' runtime screenshots.');
