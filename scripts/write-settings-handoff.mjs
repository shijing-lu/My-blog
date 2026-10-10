import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('outputs/settings-workspace');
const report = JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json'), 'utf8'));
assert.equal(report.layouts.length, 280);
assert.deepEqual(report.errors, []);
const screenshots = fs.readdirSync(out).filter(name => name.endsWith('.png')).sort();
const base = 'http://127.0.0.1:43225';
const sections = { 'site-name': '站点名称', 'hero-quotes': '首页诗词', landing: '首页头图', appearance: '外观与字体', 'image-bed': '图床', 'md-css': 'Markdown 样式', ai: 'AI', netdisk: '网盘', shortcuts: '编辑器快捷键', sync: '云端连接' };
const label = name => {
  const match = name.match(/^(page|modal)-(.+)-(\d+)-(light|dark)\.png$/);
  return match ? [match[1] === 'page' ? '设置页面' : '设置弹窗', sections[match[2]] ?? match[2], match[3] + 'px', match[4] === 'light' ? '亮色' : '暗色'].join(' · ') : name;
};
const cards = screenshots.map(name => '<figure><figcaption>' + label(name) + '</figcaption><a href="' + name + '"><img src="' + name + '" alt="' + label(name) + '" loading="lazy"></a></figure>').join('');
fs.writeFileSync(path.join(out, 'screenshots.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设置页面 · 验收截图</title><style>body{margin:0;padding:30px;background:#fbf7ee;color:#151511;font-family:system-ui,sans-serif}h1{font-size:28px}a{color:#c6370c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:24px}figure{margin:0;border:2px solid #151511;border-radius:16px;background:#fffaf1;box-shadow:4px 5px 0 #ff541f;padding:12px}img{width:100%;height:auto;border-radius:8px}figcaption{font-weight:700;margin-bottom:12px}</style><h1>设置页面 · 验收截图</h1><p>独立设置页面与前台设置弹窗；复用首页暖白、橙红、描边、硬阴影及小猫素材。</p><p><a href="' + base + '/admin/settings">打开本地预览</a> · 本地站主密码：article-review-local</p><main>' + cards + '</main></html>');

const lines = [
  '# 设置页面验收记录', '',
  '本批完成设置总入口、各分区页面和前台设置弹窗的扁平主义与新粗野主义外观，沿用首页明暗令牌、Noto Sans SC、Lucide 和同源小猫。完成后停在本批人工验收。', '',
  '## 本地预览', '',
  '- [设置入口](' + base + '/admin/settings)',
  '- [前台首页](' + base + '/)：登录后打开工具条中的设置弹窗。',
  '- 本地站主密码：`article-review-local`。',
  '- 服务器：`scripts/serve-settings-review.mjs`，端口 43225。',
  '- 数据库使用上一批动态验收副本的复制，所有内容保存只写入 `outputs/settings-workspace/test.db`。站点名称和诗词保存用例结束后已恢复副本原值。',
  '- 本地云端配置路径为 `outputs/settings-workspace/local-config.json`；没有写入实际桌面客户端配置。', '',
  '## 完成范围', '',
  '- 站点名称、首页诗词、首页头图、外观与字体、图床、Markdown 样式、AI、网盘、快捷键及桌面云端连接，共十个设置分区。旧 site-css 路由保留统一外观的兼容说明。',
  '- 桌面紧凑左侧导航和右侧纸面表单；手机使用局部滚动的分区导航，表单单列排列。诗词输入和快捷键行在窄屏换行。',
  '- 前台弹窗采用橙色标题、描边和硬阴影；导航与内容分别滚动。重新打开清空导航搜索，关闭后恢复触发按钮焦点。',
  '- 外观页增加亮色、暗色、跟随系统按钮，使用已有主题状态与事件，自动保存当前设备偏好。没有恢复旧外观选择。',
  '- 统一输入框、保存按钮、错误提示、披露区域与键盘焦点。装饰小猫复用首页，空 alt 且不进入读屏顺序。',
  '- 保留原表单标识、API、保存逻辑、上传、权限和云端功能；未修改公共 API 或数据库结构。', '',
  '## 已完成检查', '',
  '- Astro check：675 个文件，0 errors、0 warnings、43 hints。',
  '- 7 个相关既有测试文件、61 项测试通过：设置分区、管理员权限及渲染、主题、外观、本地云端配置与配置 API。',
  '- 直接 Astro Node 构建通过；存在既有的大文件提示。未运行包含数据库迁移的总构建命令。',
  '- Edge Chromium 浏览器：十个分区 × 页面/弹窗 × 七个宽度（1440、1320、1280、941、768、390、360px）× 亮色/暗色，共 280 组布局检查通过。页面、表单无横向溢出，字段保持在面板内，弹窗关闭按钮可见。',
  ...report.cases.map(item => '- 浏览器交互：' + item),
  '- 保存 ' + screenshots.length + ' 张截图；没有捕获页面 JavaScript 错误。机器结果：`outputs/settings-workspace/browser-report.json`。', '',
  '## 验证边界与人工确认', '',
  '- 站点名称、诗词使用隔离数据库中的真实保存 API；测试了校验、失败保留、重试和刷新恢复。',
  '- 图床、AI、网盘、云端连接的连通测试使用浏览器模拟响应，只验证操作及反馈，未调用真实外部服务、执行同步或保存真实连接配置。',
  '- 真实图片/字体上传、AI 模型调用、网盘传输、云数据库连接、双向同步与加密配置导入导出，仍需使用实际服务人工验收。',
  '- 快捷键录入与取消已做浏览器验证；真实客户端的编辑动作和系统快捷键冲突需人工确认。',
  '- 浏览器验收不能替代真实 Electron 或 Android 客户端验收；本批没有打包客户端或发布网站。',
  '- 请人工确认各分区视觉密度、手机操作、实际设置保存和长期使用体验；本批不继续开发其他模块。', '',
  '## 截图与复现', '',
  '- 截图索引：`outputs/settings-workspace/screenshots.html`。',
  '- 启动隔离预览：`node scripts/serve-settings-review.mjs`。',
  '- 浏览器回归：`node scripts/verify-settings-workspace.mjs`。',
];
fs.writeFileSync('docs/settings-workspace-validation.md', lines.join('\n') + '\n');
fs.writeFileSync(path.join(out, 'README.md'), lines.join('\n') + '\n');
console.log('Settings handoff written: ' + screenshots.length + ' screenshots, ' + report.layouts.length + ' layouts');
