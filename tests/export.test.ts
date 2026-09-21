/**
 * 文章导出（Markdown 附件下载）纯函数单测
 *
 * 覆盖 src/lib/export.ts 的四类行为：
 * 1. front-matter 组装（元数据 → YAML）
 * 2. 文件名清洗与 Content-Disposition（中文标题 RFC 5987）
 * 3. 站内相对路径绝对化（跳过围栏代码块）
 * 4. 导出文档组装（body + headers，no-store）
 */
import { describe, expect, it } from 'vitest';
import {
  buildMarkdownDocument,
  buildMarkdownExport,
  contentDisposition,
  sanitizeFilename,
} from '../src/lib/export';

const ORIGIN = 'https://blog.example.com';

describe('front-matter 组装（buildMarkdownDocument）', () => {
  it('生成 YAML 头并保留正文', () => {
    const md = buildMarkdownDocument(
      {
        title: '你好，世界',
        extra: { slug: 'hello', type: 'tech' },
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
      '# 正文\n\n内容',
    );
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "你好，世界"');
    expect(md).toContain('slug: "hello"');
    expect(md).toContain('type: "tech"');
    expect(md).toContain('date: "2026-01-02T03:04:05.000Z"');
    // 正文在第二个 --- 之后原样出现
    const [, , body] = md.split('---\n');
    expect(body?.trim()).toBe('# 正文\n\n内容');
  });

  it('空 tags/summary/undefined 日期不产生字段', () => {
    const md = buildMarkdownDocument({ title: 't', tags: [], summary: '' }, 'x');
    expect(md).not.toContain('tags:');
    expect(md).not.toContain('summary:');
    expect(md).not.toContain('date:');
    expect(md).not.toContain('updated:');
  });

  it('标题中的引号/换行经 YAML 转义不破坏结构', () => {
    const md = buildMarkdownDocument({ title: '他说"好"\n换行' }, 'x');
    const front = md.split('---\n')[1];
    // 双引号标量内部转义，front-matter 保持单行 title
    expect(front).toContain('title: ');
    expect(front?.split('\n').filter((l) => l.startsWith('title:'))).toHaveLength(1);
  });

  it('正文本身以 --- 开头时不误合并（用独立分隔块）', () => {
    const md = buildMarkdownDocument({ title: 't' }, '---\nkey: value\n---\n正文');
    // 前两个 --- 之间是 front-matter，其后仍是原正文
    expect(md.split('\n').slice(0, 2)).toEqual(['---', 'title: "t"']);
    expect(md.endsWith('---\nkey: value\n---\n正文')).toBe(true);
  });
});

describe('文件名清洗（sanitizeFilename）', () => {
  it('移除文件系统非法字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('首尾的点与空白被裁剪，纯非法输入回落 fallback', () => {
    expect(sanitizeFilename('  ..中文标题..  ')).toBe('中文标题');
    expect(sanitizeFilename('???')).toBe('article');
    expect(sanitizeFilename('')).toBe('article');
  });

  it('连续空白折叠为单下划线并限制长度', () => {
    expect(sanitizeFilename('a   b')).toBe('a_b');
    expect(sanitizeFilename('长'.repeat(200)).length).toBeLessThanOrEqual(100);
  });
});

describe('Content-Disposition（contentDisposition）', () => {
  it('ASCII 文件名直接用引号型 filename', () => {
    expect(contentDisposition('Report-2026.md')).toBe('attachment; filename="Report-2026.md"');
  });

  it('中文文件名用 RFC 5987 filename*，另给 ASCII 兜底名', () => {
    const header = contentDisposition('你好.md');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent('你好.md'));
    expect(header).toContain('filename="export.md"');
  });
});

describe('相对路径绝对化', () => {
  const abs = (src: string) =>
    buildMarkdownExport({ meta: { title: 't' }, source: src, origin: ORIGIN }).body;

  it('markdown 图片与链接的站内绝对路径被补全', () => {
    const out = abs('![图](/api/images/abc)\n[链](/blog/x)');
    expect(out).toContain(`![图](${ORIGIN}/api/images/abc)`);
    expect(out).toContain(`[链](${ORIGIN}/blog/x)`);
  });

  it('HTML img src 与 CSS url() 同样补全', () => {
    const out = abs('<img src="/img/a.png"> [样式](/css) <style>background:url(/bg.png)</style>');
    expect(out).toContain(`src="${ORIGIN}/img/a.png"`);
    expect(out).toContain(`url(${ORIGIN}/bg.png)`);
  });

  it('锚点、外链、协议相对链接保持不变', () => {
    const src = '[a](#toc) [b](https://x.com/y) [c](//cdn/z.png)';
    expect(abs(src)).toContain(src);
  });

  it('围栏代码块内的示例路径不被改写', () => {
    const out = abs('说明 ![i](/api/x)\n\n```md\n![i](/api/in-fence)\n```\n\n尾 ![t](/api/y)');
    expect(out).toContain('![i](/api/in-fence)');
    expect(out).toContain(`![i](${ORIGIN}/api/x)`);
    expect(out).toContain(`![t](${ORIGIN}/api/y)`);
  });
});

describe('导出文档组装（buildMarkdownExport）', () => {
  it('返回 body 与下载/防缓存响应头', () => {
    const r = buildMarkdownExport({
      meta: { title: '我的文章', extra: { slug: 'mine' } },
      source: '正文 ![](/api/images/1)',
      origin: ORIGIN,
    });
    expect(r.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(r.headers['content-disposition']).toContain(encodeURIComponent('我的文章.md'));
    expect(r.body).toContain('title: "我的文章"');
    expect(r.body).toContain(`![](${ORIGIN}/api/images/1)`);
  });
});
