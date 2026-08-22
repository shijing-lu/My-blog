/**
 * 图片服务单元测试（纯函数）
 */
import { describe, expect, it } from 'vitest';
import { extractFirstImage, validateImageUpload, ALLOWED_MIME, MAX_IMAGE_BYTES } from '../src/lib/images';

describe('images', () => {
  it('从 MDX 源码提取第一张图片 URL', () => {
    expect(extractFirstImage('先看 ![图一](https://a.com/1.png) 再 ![图二](https://a.com/2.jpg)')).toBe('https://a.com/1.png');
    expect(extractFirstImage('![标题带空格](data:image/svg+xml;charset=utf-8,%3Csvg%3E)')).toContain('data:image/svg+xml');
    expect(extractFirstImage('没有图片的正文')).toBeNull();
    expect(extractFirstImage('')).toBeNull();
  });

  it('校验上传参数（MIME 白名单 / 大小上限）', () => {
    const b64 = Buffer.from('fake').toString('base64');
    expect(validateImageUpload('image/png', b64, 4)).toBeNull();
    expect(validateImageUpload('image/svg+xml', b64, 4)).toBeNull();
    expect(validateImageUpload('text/html', b64, 4)).toContain('仅支持');
    expect(validateImageUpload('image/png', '', 0)).toContain('缺少');
    expect(validateImageUpload('image/png', b64, MAX_IMAGE_BYTES + 1)).toContain('5MB');
  });

  it('ALLOWED_MIME 覆盖常见图片类型', () => {
    expect(ALLOWED_MIME.test('image/png')).toBe(true);
    expect(ALLOWED_MIME.test('image/jpeg')).toBe(true);
    expect(ALLOWED_MIME.test('image/webp')).toBe(true);
    expect(ALLOWED_MIME.test('image/gif')).toBe(true);
    expect(ALLOWED_MIME.test('application/pdf')).toBe(false);
  });
});
