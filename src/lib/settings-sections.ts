/** One settings navigation contract for dialogs and standalone pages. */
export type SettingsSection = 'site-name' | 'hero-quotes' | 'landing' | 'appearance' | 'image-bed' | 'md-css' | 'site-css' | 'ai' | 'netdisk' | 'shortcuts' | 'sync';

export interface SettingsSectionDefinition {
  id: SettingsSection;
  label: string;
  href: string;
  keywords: string;
  desktopOnly?: boolean;
}

const sections: readonly SettingsSectionDefinition[] = [
  { id: 'site-name', label: '站点名称', href: '/admin/settings/site-name', keywords: '站点名称 site name 标题 品牌' },
  { id: 'hero-quotes', label: '诗词轮播', href: '/admin/settings/hero-quotes', keywords: '诗词轮播 hero quotes 首页 古诗 名言' },
  { id: 'landing', label: '落地页', href: '/admin/settings/landing', keywords: '落地页 landing 头图 副标题 hero' },
  { id: 'appearance', label: '外观', href: '/admin/settings/appearance', keywords: '外观 新粗野主义 neobrutalism 明暗 系统 字体 font 背景 background' },
  { id: 'image-bed', label: 'GitHub 图床', href: '/admin/settings/image-bed', keywords: '图床 github image bed 上传 粘贴 图片 仓库 token' },
  { id: 'md-css', label: 'Markdown 样式', href: '/admin/settings/md-css', keywords: 'markdown css 样式 自定义 正文 代码 表格 覆盖' },
  { id: 'ai', label: 'AI 助手', href: '/admin/settings/ai', keywords: 'ai 助手 小卿 pi api 订阅 ChatGPT Claude Copilot 模型 技能 文章 封面 deepseek openai 测试连接' },
  { id: 'netdisk', label: '网盘对接', href: '/admin/settings/netdisk', keywords: '网盘 蓝奏云 lanzou alist 上传 下载 文件' },
  { id: 'shortcuts', label: '编辑器快捷键', href: '/admin/settings/editor-shortcuts', keywords: '快捷键 编辑器 键位 录制 markdown ctrl' },
  { id: 'sync', label: '云端同步', href: '/admin/settings/sync', keywords: '云端 同步 sync 本地 数据', desktopOnly: true },
];

export function getSettingsSections(desktop: boolean): readonly SettingsSectionDefinition[] {
  return sections.filter(section => desktop || !section.desktopOnly);
}
