/**
 * 封面解析（resolveCover）单元测试：手动封面优先，否则回落到正文首图
 */
import { describe, expect, it } from 'vitest';
import { resolveCover } from '../src/lib/articles';

describe('resolveCover', () => {
  it('手动封面优先于正文首图', () => {
    expect(
      resolveCover({ cover: 'https://a.com/cover.png', content: '![正文图](https://b.com/1.png)' }),
    ).toBe('https://a.com/cover.png');
  });

  it('无手动封面时回落到正文第一张图', () => {
    expect(
      resolveCover({ cover: '', content: '先看 ![图一](https://a.com/1.png) 再 ![图二](https://a.com/2.jpg)' }),
    ).toBe('https://a.com/1.png');
  });

  it('正文无图且未指定封面时返回 null', () => {
    expect(resolveCover({ cover: null, content: '没有图片的正文' })).toBeNull();
  });

  it('全空格封面视为未指定', () => {
    expect(resolveCover({ cover: '   ', content: '' })).toBeNull();
  });

  it('手动封面支持本地上传地址 /api/images/<id>', () => {
    expect(resolveCover({ cover: '/api/images/abc-123', content: '' })).toBe('/api/images/abc-123');
  });
});
