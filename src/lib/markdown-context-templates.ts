import type { CalloutType, MarkVariant } from './markdown-format-catalog';
import { serializeMarkdownColumns } from './markdown-columns';

export interface MarkdownTemplate { source: string; focusFrom: number; focusTo: number }
export function codeBlockTemplate(content = ''): MarkdownTemplate {
  let length = 3;
  for (const match of content.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  const focusFrom = fence.length + 1;
  return { source: `${fence}\n${content}\n${fence}`, focusFrom, focusTo: focusFrom + content.length };
}
function template(source: string, focusText: string): MarkdownTemplate {
  const focusFrom = Math.max(0, source.indexOf(focusText));
  return { source, focusFrom, focusTo: focusFrom + focusText.length };
}

export function calloutTemplate(type: CalloutType, fold: '' | '+' | '-' = ''): MarkdownTemplate {
  return template(`> [!${type}]${fold} 标题\n> 正文`, '标题');
}

export function tableTemplate(): MarkdownTemplate {
  return template('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |', '内容');
}

export function columnsTemplate(count: 2 | 3): MarkdownTemplate {
  const { source, block } = serializeMarkdownColumns(Array.from({ length: count }, () => ''));
  return { source, focusFrom: block.columns[0]!.from, focusTo: block.columns[0]!.from };
}

export interface GalleryOptions { columns: number; aspect: string; fit: 'cover' | 'contain' }
export function galleryTemplate({ columns, aspect, fit }: GalleryOptions): MarkdownTemplate {
  if (!Number.isInteger(columns) || columns < 1 || columns > 6 || !/^\d{1,3}\/\d{1,3}$/.test(aspect) ||
      aspect.split('/').some((n) => Number(n) <= 0)) throw new Error('图片画廊参数无效');
  return template(`:::grid columns=${columns} aspect=${aspect} fit=${fit}\n\n![图片描述](图片地址)\n\n:::`, '图片地址');
}

export function tabsTemplate(count: 2 | 3, stableId = ''): MarkdownTemplate {
  if (stableId && !/^[\w-]+$/.test(stableId)) throw new Error('选项卡组 ID 只能使用字母、数字、下划线和短横线');
  const sections = Array.from({ length: count }, (_, index) =>
    `@tab${index === 0 ? ':active' : ''} 选项卡${index + 1}\n\n内容${index + 1}`);
  return template(`:::tabs${stableId ? `#${stableId}` : ''}\n\n${sections.join('\n\n')}\n\n:::`, '选项卡1');
}

export function collapseTemplate(accordion: boolean, expand: boolean): MarkdownTemplate {
  const flags = [accordion && 'accordion', expand && 'expand'].filter(Boolean).join(' ');
  return template(`:::collapse${flags ? ` ${flags}` : ''}\n\n- 面板标题\n\n  面板正文\n\n:::`, '面板标题');
}

export function inlineTemplate(kind: 'strong' | 'em' | 'strike' | 'underline' | 'spoiler' | 'mark', text: string, variant: MarkVariant = 'primary'): string {
  switch (kind) {
    case 'strong': return `**${text}**`;
    case 'em': return `*${text}*`;
    case 'strike': return `~~${text}~~`;
    case 'underline': return `<u>${text}</u>`;
    case 'spoiler': return `:spoiler[${text.replace(/([\\\]])/g, '\\$1')}]`;
    case 'mark': return variant === 'primary' ? `==${text}==` : `==${text}=={.${variant}}`;
  }
}
