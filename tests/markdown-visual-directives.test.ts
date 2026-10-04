import { describe, expect, it } from 'vitest';
import { scanVisualDirectives } from '../src/lib/markdown-visual-directives';

describe('提示块可视化扫描', () => {
  it('保留围栏长度、类型和正文源码范围', () => {
    const source = '开头\n\n::::warning\n正文 **加粗**\n\n:::note\n内层\n:::\n::::\n\n结尾';
    const [block] = scanVisualDirectives(source);
    expect(block?.kind).toBe('admonition');
    expect(block?.admonitionType).toBe('warning');
    expect(block?.opening.text).toBe('::::warning');
    expect(block?.items[0]?.body?.text).toContain('正文 **加粗**');
    expect(source.slice(block!.from, block!.to)).toBe(block?.raw);
  });

  it('未闭合或不合法的提示块保留源码', () => {
    expect(scanVisualDirectives(':::tip\n正文')).toEqual([]);
    expect(scanVisualDirectives(':::warning 自定义标题\n正文\n:::')).toEqual([]);
  });
});
