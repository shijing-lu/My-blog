import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const docs = path.join(root, 'docs/Android原生');
const catalog = fs.readFileSync(path.join(root, 'android-native/core/model/src/main/kotlin/com/byqx/core/model/FoundationModels.kt'), 'utf8');
const currentStage = Number(catalog.match(/const val STAGE = (\d+)/)?.[1] ?? 1);
const previousMatrix = fs.existsSync(path.join(docs, '03-功能矩阵.md')) ? fs.readFileSync(path.join(docs, '03-功能矩阵.md'), 'utf8') : '';
const previousStatuses = new Map([...previousMatrix.matchAll(/^\| (F\d+) \|.* \| ([^|]+) \|$/gm)].map(m => [m[1], m[2]]));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const routes = walk(path.join(root, 'src/pages')).filter(f => /\.(astro|ts)$/.test(f)).map(f => {
    const source = fs.readFileSync(f, 'utf8');
    const file = relative(f);
    return { file, route: '/' + file.replace('src/pages/', '').replace(/\.(astro|ts)$/, '').replace(/\/index$/, '').replace(/^index$/, ''), methods: [...source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/g)].map(m => m[1]), sha256: crypto.createHash('sha256').update(source).digest('hex') };
});
const rows = [
    // Feature / Web entry / API or semantic source / preserved fields / mobile entry / offline rule / stage / acceptance
    ['首页与诗词落地页','/','/api/landing; /api/quote-settings','头图/标题/副标题/诗词轮播/排序','首页','展示缓存1h',4,'首页内容与Web一致'],
    ['文章分类标签归档','/; /tags/[tag]; /archive','/api/article-categories; /api/search','分类/标签/type/slug/分页','首页→文章','列表缓存5min',4,'筛选组合和标签定位'],
    ['全站和正文搜索','/; /doc','/api/search; /api/doc/search','q/scope/page/pageSize/snippet','搜索','已下载资料本地搜索',4,'标题与正文命中、离线范围说明'],
    ['文章详情与解锁','/blog/[slug]','/api/unlock-article; src/lib/article-password.ts','正文/标题/密码状态/元数据','文章详情','受保护内容按账号隔离',4,'正确错误密码与重新访问'],
    ['阅读状态与目录','/blog/[slug]; /doc/[id]','src/lib/reading.ts; src/lib/article-detail-rails.ts','锚点/位置/展开状态','右侧目录浮层','本机保存位置',4,'跳转关闭浮层、返回恢复'],
    ['基础Markdown','文章/文档/随心录/动态','src/lib/mdx.ts','标题/列表/引用/链接/表格/代码','原生正文','本地解析',4,'真实长文与源码保持'],
    ['公式与脚注','正文','src/lib/mdx-plugins.ts','TeX/编号/脚注ID/链接','原生正文','本地原生排版',4,'矩阵、分式、表格内公式与脚注返回'],
    ['高亮与提示','正文','src/lib/markdown-format-catalog.ts','Mark语义色/Admonition/Callout类型/折叠','正文','本地解析',4,'全部已有变体'],
    ['折叠与标签组','正文','src/components/mdx/registry.tsx','Collapse状态/accordion/Tabs stableId/active','正文','本机交互状态',4,'嵌套、同ID跨组联动'],
    ['网格多栏剧透','正文','src/lib/mdx/columns.ts; src/lib/mdx/spoiler.ts','列比/网格比例/fit/剧透段','正文','本地解析',4,'窄屏换行、交互独立'],
    ['代码与图片预览','正文','src/components/mdx/registry.tsx','语言/行号/复制/折叠/alt/caption/灯箱分组','正文→图片','按需资源缓存',4,'复制缩放、宽代码局部滚动'],
    ['Markdown导出','文章/文档','/api/export/article/[slug]; /api/export/doc/[id]','frontmatter/原文/资源URL','系统分享/SAF','已下载原文可导出',4,'回读正文与字段不丢'],
    ['完整源码编辑','/edit/[id]; /edit/new','/api/articles; /api/save-draft','正文/标题/摘要/标签/类型/封面','文章编辑','先本地保存+outbox',5,'中文输入、撤销、后台恢复'],
    ['可视编辑与预览','文档/文章编辑','src/components/admin/MarkdownEditor.tsx; /api/articles/preview','源码范围/光标/选择/显示模式','编辑器','本地解析与回写',5,'模式切换无源码损坏'],
    ['组件格式菜单','编辑器','src/lib/markdown-visual-directives.ts','表格/公式/图片/Callout/Tabs/Grid/Columns/Collapse','键盘工具栏/面板','本地修改',5,'菜单操作与嵌套块源码保持'],
    ['查找折叠快捷键','编辑器','src/components/admin/cm-search-folds.ts; /api/editor-shortcuts','查找替换/标题折叠/键位','编辑器','本机配置',5,'多行替换、折叠搜索和外接键盘'],
    ['图片粘贴上传','编辑器','/api/images; /api/image-bed-settings','图片引用/资源ID/上传状态','编辑器→媒体','附件本地队列',5,'离线插图、重试不重复'],
    ['文档分类册','/doc','/api/doc/categories; /api/doc/bundles','分类/册名/图标/摘要/sort','文档','Room持久+同步',6,'分类册增删改与级联提示'],
    ['文档树管理','/doc/[id]','/api/doc/nodes; /api/doc/nodes/[id]','parentId/类型/标题/内容/sort','树/面包屑','Room持久+同步',6,'深层移动排序与删除'],
    ['文档文章兼容','/doc','/api/doc/articles; /api/doc/articles/[id]','bundleId/文章字段/原文','文档编辑','本地编辑',6,'新旧文档数据回读'],
    ['整册离线下载','/doc','/api/doc; /api/doc/nodes/[id]/render','节点/原文/资源清单/版本','文档→下载','固定保存且可取消',6,'飞行模式整册与附件'],
    ['随心录闭环','/quick-notes','/api/mobile/v1/sync; /api/quick-notes; /api/quick-notes/[id]','id/title/content/tags/时间/版本/游标/opId/墓碑','首页→随心录','加密Room草稿、同事务outbox、三份冲突保留',3,'断网编辑、进程恢复、幂等、Web冲突与删除'],
    ['随心录完整体验','/quick-notes; 浮动入口','/api/quick-notes/preview','搜索/预览/删除/来源','首页快捷区','本地搜索编辑',7,'历史与正文语法'],
    ['日志历史编辑','/diary; /calendar/diary','/api/diary; /api/diary/source-dates','日期/正文/来源/更新时间','日志','持久本地+同步',7,'历史日期与编辑保留'],
    ['日志生成','/diary','/api/diary/generate','源日期/生成参数/结果','日志→生成','输入可保存，生成需联网',7,'生成失败保留原记录'],
    ['农历日期热力图','/calendar','/api/calendar-month; src/lib/lunar.ts','日期/节气/节日/活动','日历','本地日历计算+缓存',8,'跨月跨年与历史记录'],
    ['重要日期与待办','/calendar','/api/calendar-events; /api/todos','开始结束/标题/状态/日期','日历','持久本地+同步',8,'日期边界与任务更新'],
    ['学习能力核对','/calendar关联入口','db/schema.sqlite.ts; src/lib/calendar.ts','study/checkin任务/会话/分心/记录','日历→学习','本地计时保存','8','需核定当前可用入口，历史表不等于UI已实现'],
    ['Cadence总览','/schedule','src/cadence/pages/dashboard','计划进度/执行时长/待复盘/倒计时','日程总览','本地聚合',9,'计算口径一致'],
    ['长期与每日计划','/schedule/plans','src/cadence/features; /api/cadence/sync','层级任务/日期/标签/估时/排序/完成','计划','专用CAS',9,'三层任务与单向联动'],
    ['分钟日程','/schedule/schedule','src/cadence/entities/schedule/model.ts','dateKey/startMin/endMin/refKind/refId/done','时间轴','本地校验+CAS',9,'1min、24:00边界、重叠拒绝'],
    ['执行计时补录','/schedule/execute','src/cadence/pages/execute','开始结束/暂停累计/关联/备注','执行','时间戳恢复',9,'单活动计时器、重启与暂停'],
    ['周期复盘','/schedule/review','src/cadence/pages/review','周期长度/锚点/文本/心情','复盘','专用CAS',10,'改配置不丢历史'],
    ['XY待办回收站','/schedule/todos','src/cadence/pages/todos','坐标/区域/标签/日期/完成/归档','待办看板','专用CAS',10,'坐标拖动、删除恢复'],
    ['统计倒计时','/schedule/stats; /schedule','src/cadence/pages/stats','趋势/完成/执行/目标时刻','统计/总览','本地聚合',10,'历史与时间计算'],
    ['Cadence导入导出','/schedule/settings','src/cadence/pages/settings/ui/DataManagement.tsx','JSON版本/全部记录/执行复盘CSV','数据管理','本地原子导入',10,'坏包回滚、重复ID明示'],
    ['相册媒体管理','/gallery; /gallery/upload','/api/photos; /api/photos/[id]; /api/photos/batch-tags','资源/标签/排序/标题/日期','相册','媒体缓存+上传队列',11,'批量标签与上传重试'],
    ['动态与互动管理','/moments; /moments/[id]','/api/moments; /api/comments; /api/likes; /api/views','原文/资源/评论/点赞/阅读','动态/内容管理','本地内容；互动按幂等规则',11,'CRUD和已有评论回读'],
    ['导航分类站点','/nav; /admin/nav','/api/nav/categories; /api/nav/sub-categories; /api/nav/sites','名称/URL/图标/分类/排序','导航站','本地缓存编辑',11,'分类移动与外链'],
    ['导航扫描','/admin/nav','/api/nav/sites/scan','网址/元数据/扫描结果','站点编辑','扫描需联网',11,'失败不覆盖手动信息'],
    ['思维导图画布','/admin/mindmaps; /admin/mindmaps/[id]','/api/mindmaps; /api/mindmaps/[id]','root/layout/theme/view/节点未知字段','导图','本地原样保存+同步',12,'节点手势与布局回读'],
    ['思维导图生成引用导出','文档/导图','/api/mindmaps/generate; /api/mindmaps/[id]/refs','正文块ID/引用/PNG/SVG/大纲','导图/正文跳转','本地画布导出；AI生成需联网',12,'引用定位与文件回读'],
    ['网盘目录链接下载','/admin/netdisk','/api/netdisk/list; /api/netdisk/links; /api/netdisk/download','目录/条目/链接/下载状态','网盘','远端操作联网，已下载离线',12,'真实连接与下载恢复'],
    ['AI聊天历史','全局AI入口','/api/ai/chat; src/lib/ai-store.ts','流式消息/会话/上下文/附件','小卿','历史本地，生成联网',13,'流中断保留已接收内容'],
    ['AI摘要记忆养成','AI入口','/api/ai/summarize; /api/ai/memory; src/lib/ai-bond.ts','摘要/记忆/养成/原文/日期','小卿管理','本地历史与同步',13,'私人数据与记忆增删改'],
    ['Cadence助手','/schedule','/api/cadence/assistant','意图/参数/澄清/回执','日程→助手','本地规则；LLM联网',13,'删除确认与真实执行结果'],
    ['个人资料','/manage','/api/profile','昵称/头像/简介/链接','我的→资料','本地修改+同步',14,'资料Web回读'],
    ['网站授权申请管理','/admin/auth','/api/admin-auth/accounts; /api/admin-auth/applications; /api/admin-auth/profile-sync','GitHub账号/权限/申请状态','站点管理→账号','管理动作需联网',14,'审批撤销与Web权限保持'],
    ['内容运维管理','/admin; /manage','文章/文档/动态/图片CRUD','发布/元数据/分类/标题/删除','站点管理','内容可离线，运维需联网',14,'没有访客模式但保留网站管理'],
    ['名称诗词落地页设置','/admin/settings','/api/site-name; /api/quote-settings; /api/landing','名称/诗词/背景/布局','站点设置','展示缓存，配置同步',14,'Web回读与原生品牌'],
    ['外观字体背景','/admin/settings/appearance','/api/ui-style; /api/fonts-settings; /api/fonts; /api/background','风格/字体/背景/模糊/上传','站点设置/本机外观','本机Token与Web配置分开',14,'动态取色与Web设置不混淆'],
    ['Markdown与全站CSS','/admin/settings/md-css; /admin/settings/site-css','/api/md-css; /api/md-css/library; /api/site-css','CSS原文/样式库','站点设置','原样编辑同步，仅作用Web',14,'CSS保真、不执行网页'],
    ['图床配置测试','/admin/settings/image-bed','/api/image-bed-settings; /api/image-bed-test','仓库/分支/路径/Token','站点设置','密钥加密，测试联网',14,'密钥不入日志'],
    ['AI网盘配置','/admin/settings/ai; /admin/settings/netdisk','/api/ai/config; /api/ai/test; /api/netdisk-settings; /api/netdisk-test','地址/模型/凭据/连接状态','站点设置','凭据加密，测试联网',14,'错误连接与已有配置'],
    ['快捷键云同步设置','/admin/settings/editor-shortcuts; /admin/settings/sync','/api/editor-shortcuts; /api/desktop/sync-config','键位/服务地址/同步状态','我的→设置','本机配置；高风险联网',14,'服务绑定与桌面云配置语义不同'],
    ['数据库迁移工具','站点设置','/api/sync-databases; /api/migrate-*','迁移状态/报告','运维工具','联网且执行前确认',14,'不可恢复网络后自动执行'],
    ['旧数据备份恢复','桌面/旧安卓','scripts/export-android-data.mjs','原文/资料/资源/格式版本','数据管理','原子导入与完整校验',15,'摘要确认、附件与回滚'],
    ['缓存下载清理','所有模块','原生Room/文件清单','版本/大小/下载/固定保存/待上传','我的→存储','清理不得删除草稿与下载',15,'占用预览与飞行模式'],
    ['站点RSS外链','/rss.xml','src/pages/rss.xml.ts','订阅URL/链接','文章→系统分享','网址可离线保存',4,'分享Web RSS地址，不造访客页面'],
    ['动效实验室迁移','/design/material3; /schedule/motion-lab','现有设计参考与动效样例','12类/取消/终态','原生体验室','完全本地',15,'交互正确与减少动效'],
];
rows.push(['个人身份与连接', '/login; /api/admin-auth/login', '/api/mobile/v1/auth/[action]; src/lib/mobile-auth.ts',
    '服务地址/deviceId/owner/serverId/会话有效期', '我的→连接与认证', '加密凭据恢复；失效保留绑定；内容离线从阶段3交付', 2,
    '口令错误、重启、Keystore、断网恢复、刷新、撤销、拒绝Cookie']);
rows.push(['离线同步底座', '随心录Web/桌面入口', '/api/mobile/v1/sync; src/lib/mobile-sync-store.ts',
    'serverId/cursor/opId/baseRevision/确认/墓碑/base-local-remote', '随心录→同步与冲突页', '加密Room/outbox/草稿；WorkManager联网约束与退避', 3,
    '事务回滚、丢响应重试、飞行中编辑、换站隔离、浏览零请求']);
const matrixHeader = '# 全功能迁移矩阵\n\n基线：2026-10-07。逐项保留语义；状态“计划”表示尚未实现。第1阶段只交付基础工程。实际字段以链接源码及第2阶段契约盘点为准，不读取 .env 或私人数据库。每阶段开工前重新生成页面/API基线并检查新增功能。\n\n| ID | 功能 | Web入口 | API/语义源 | 保留字段 | 原生入口 | 离线行为 | 阶段 | 验收 | 状态 |\n|---|---|---|---|---|---|---|---|---|---|\n';
const escape = s => String(s).replaceAll('|', '\\|').replaceAll('\n',' ');
fs.writeFileSync(path.join(docs, '03-功能矩阵.md'), matrixHeader.replace('第1阶段只交付基础工程。', `当前第${currentStage}阶段；基础工程和身份连接分阶段交付。`) + rows.map((r,i) => {
    const id = `F${String(i+1).padStart(3,'0')}`;
    const previous = previousStatuses.get(id);
    const status = previous && previous !== '计划' ? previous : r[0] === '个人身份与连接' && currentStage >= 2 ? '已实现，等待用户验收' : '计划';
    return `| ${id} | ${r.map(escape).join(' | ')} | ${status} |`;
}).join('\n') + '\n\n第1阶段已实现导航/主题/本机外观持久化/系统减少动效/输入状态恢复/组件演示；以上业务项没有因此标记完成。身份连接的检查记录详见第2阶段验收。\n');
const excludes = r => /\/api\/auth\/|\/api\/login$|\/api\/logout$|^\/login$/.test(r.route);
const inventory = '# 页面和API覆盖基线\n\n生成日期：2026-10-07。自动扫描当前源码，不访问私人数据。字段/业务语义详见功能矩阵；此表确保动态路由与没有主导航的API不遗漏。GitHub登录与访客身份流程保持在Web，不建设App客户端；账号管理仍纳入迁移。\n\n| 路由 | 方法 | 源码 | App处理 |\n|---|---|---|---|\n' + routes.map(r=>`| ${r.route} | ${r.methods.join('/') || 'PAGE/handler'} | ${r.file} | ${excludes(r) ? 'Web保留；App仅站主口令绑定' : '纳入功能矩阵核对；静态/图片资源按原生语义适配'} |`).join('\n');
fs.writeFileSync(path.join(docs, '05-API与页面盘点.md'), inventory + '\n');
fs.writeFileSync(path.join(docs, 'route-baseline.json'), JSON.stringify({ date: '2026-10-07', routes }, null, 2) + '\n');
console.log(`矩阵 ${rows.length} 项，页面/API ${routes.length} 条；未读取私人数据库或环境凭据。`);
