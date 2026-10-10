import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('outputs/discovery-workspace'),base='http://127.0.0.1:43227';
const reports=Object.fromEntries(['browser','polish','spa','management'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(out,name+'-report.json'),'utf8'))]));
assert.equal(reports.browser.layouts.length,87);assert.equal(reports.polish.layouts.length,20);
for(const report of Object.values(reports))assert.deepEqual(report.errors,[]);
assert.ok(reports.spa.cases.length&&reports.management.cases.length);
const log=fs.readFileSync(path.join(out,'astro-check.log'),'utf8');assert.match(log,/0 errors/);assert.match(log,/0 warnings/);
const images=fs.readdirSync(out).filter(name=>name.endsWith('.png')&&name!=='failure.png').sort();
const links=[['网站导航','/nav'],['导航管理','/admin/nav'],['影集','/gallery'],['影集上传与管理','/gallery/upload']];
const cases=[...reports.browser.cases,...reports.spa.cases,...reports.management.cases];
const document=[
  '# 导航与影集模块验收记录','',
  '本批完成公开网站导航、导航管理、公开影集及影集上传与管理四个界面的改造。采用首页暖白纸面、橙红强调、黑色描边、硬阴影、Noto Sans SC 和同源小猫；停在本批人工验收。','',
  '## 本地预览','',
  ...links.map(([name,route])=>'- ['+name+']('+base+route+')'),
  '- 本地站主验收密码：`article-review-local`。',
  '- 端口 43227；SQLite 副本：`outputs/discovery-workspace/test.db`。所有增删改测试仅写入该副本，没有修改真实导航或照片。',
  '- 导航示例的网站 URL 使用 `example.invalid`；影集示例复用首页替代图，标题均标明验收示例。截图数量随管理测试增删而变化，均来自当时的真实测试记录。',
  '- 自动上传预览默认无图床／R2 凭据，可以使用 URL 导入。队列验收只使用临时假配置，并拦截存储写请求；测试后已清理假配置。','',
  '## 完成内容','',
  '- 导航：重建标题、收藏搜索、分类按钮和网站纸卡；完整网站名称保留在提示和可访问名称中。搜索匹配当前分类的名称、简介及 URL，包含清除、结果计数和无结果提示。',
  '- 桌面宽度达到 1280px 后启用紧凑左侧分类栏；较窄屏幕保留局部滚动的分类栏。现有分类／子分类、网站拖拽移动、分类排序、会话内分类恢复和原地重绘继续有效。',
  '- 导航管理：分类、网站表单与列表统一为纸面面板，补充输入可访问名称；手机分类名独占一行，移动／编辑／删除操作按宽度换行。',
  '- 影集：保留日期分组和最短列瀑布流，将标题、日期改为持续可见的卡片说明；移除“未来可放功能”的占位区。桌面使用右侧独立时间线，窄屏使用可收起的日期横条。',
  '- 影集上传与管理：上传、URL 导入和已有照片三个面板统一外观；手机使用单列编辑卡，保留照片选择、保存、删除和批量标签。较长的 R2 配置说明收起到详情中，展开后代码换行。',
  '- 灯箱：照片缩略图仍用于列表，原图用于大图；仅影集灯箱采用新描边、纸面及橙色硬阴影，保留键盘／触控切换、关闭与焦点恢复。',
  '- 复用首页探头猫和公共页脚趴猫，装饰不进入读屏顺序；每页保持一个语义主标题。','',
  '## 同批修复','',
  '- 原影集将首批 30 张的返回数量作为总数，导致“更多”入口提前消失。公开页和 GET `/api/photos` 现共用可见照片集合，总数和时间线按全量可见记录计算，分页偏移按过滤后的记录计算，避免 R2 孤儿记录造成重复或遗漏。接口响应字段保持不变。',
  '- 存储探测复用既有五分钟缓存，并发最多 16 个；未改数据库结构、存储上传方式和孤儿清理规则。当前实现读取筛选后的整份元数据并计算总数，超大影集及真实 R2 网络耗时仍需现场评估。',
  '- 公共照片首屏与后续分页改为共用卡片模板；图片加载失败时去掉破图纸卡，并在没有可显示图片时给出刷新提示。缓存失败发生在脚本启动之前也会被处理。',
  '- 修正旧 `hidden` 类与新宽屏侧栏的显示规则冲突，确保横向分类栏收起后侧栏可用。','',
  '## 已完成检查','',
  '- Astro check：677 个文件，0 errors、0 warnings、43 个既有 hints。直接 Astro Node 构建通过；仍有现有大分包提示。没有运行包含数据库迁移的总构建命令。',
  '- 8 个相关测试文件，112 项通过：导航渲染与管理渲染、照片时间线／标签／卡片／可见分页以及管理员权限。',
  '- Edge Chromium：4 个页面 × 7 个宽度（1440、1320、1280、941、768、390、360px）× 亮暗模式 = 56 组站主管理布局；2 个公开页面 × 相同宽度／模式 = 28 组游客布局；另有 3 组上传队列布局，共 87 组。没有页面级横向溢出。',
  '- 手机输入框与说明调整后追加 20 组布局复查；验证分类名宽度、展开的配置文本边界及各宽度分类入口。',
  '- '+reports.browser.dialogs.length+' 组弹窗边界检查，覆盖添加网址、编辑网址、添加分类、灯箱和危险操作确认；另检查编辑分类图标与原生弹窗焦点恢复。',
  '- 粘贴工具脚本通过悬停、键盘焦点、多图、文本输入保留及监听器清理检查。',
  ...cases.map(item=>'- 浏览器回归：'+item),
  '- 没有捕获页面 JavaScript 错误。'+images.length+' 张关键截图见 `outputs/discovery-workspace/screenshots.html`。','',
  '## 人工验收边界','',
  '- 外部网站自动抓取图标／简介、真实 GitHub 或 R2 上传成功、外链防盗链和远端存储删除没有执行；自动上传测试验证的是队列、压缩和失败反馈。',
  '- 真实 Android／桌面客户端、移动端手势及输入法需设备验收；没有打包客户端或发布网站。',
  '- 请确认照片裁切、目录／卡片密度、长名称及亮暗配色。截图中的占位照片与示例网站不作为实际内容验收。','',
  '## 复现入口','',
  '- 预览：`rtk node scripts/serve-discovery-review.mjs`。',
  '- 准备演示数据：`rtk node scripts/seed-discovery-review.mjs`（仅重置隔离副本内的导航／照片示例）。',
  '- 主要浏览器回归：`rtk node scripts/verify-discovery-workspace.mjs`。',
  '- 补充脚本：`verify-discovery-polish.mjs`、`verify-discovery-spa.mjs`、`verify-discovery-management.mjs`、`verify-gallery-paste.mjs`。','',
];
fs.writeFileSync('docs/discovery-workspace-validation.md',document.join('\n'));
fs.writeFileSync(path.join(out,'README.md'),document.join('\n'));
const cards=images.map(name=>'<figure><figcaption>'+name.replace('.png','')+'</figcaption><a href="'+name+'"><img loading="lazy" src="'+name+'" alt="'+name.replace('.png','')+'"></a></figure>').join('');
fs.writeFileSync(path.join(out,'screenshots.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>导航与影集验收截图</title><style>body{margin:0;padding:30px;background:#fbf7ee;color:#151511;font-family:system-ui,sans-serif}a{color:#c6370c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:24px}figure{margin:0;padding:12px;border:2px solid #151511;border-radius:16px;background:#fffaf1;box-shadow:4px 5px 0 #ff541f}img{width:100%;height:auto;border-radius:8px}figcaption{font-weight:700;overflow-wrap:anywhere;margin-bottom:12px}</style><h1>导航与影集 · 验收截图</h1><p>首页同源风格与小猫，'+images.length+' 张截图。示例来自隔离副本，真实内容未修改。</p><p>'+links.map(([name,route])=>'<a href="'+base+route+'">'+name+'</a>').join(' · ')+' · 本地密码 article-review-local</p><main>'+cards+'</main></html>');
console.log('Discovery handoff: '+images.length+' screenshots, 87 layouts + 20 final checks');
