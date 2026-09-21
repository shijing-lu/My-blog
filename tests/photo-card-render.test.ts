/**
 * 影集「管理卡片」同构模块契约测试
 *
 * 背景：`/gallery/upload` 的 URL 导入成功后原先整页 `reload()`，会把「标签保留」的
 * 意图一起抹掉。现在改为客户端向 `/gallery/manage-cards?id=` 取回单张卡 HTML 就地插入，
 * 而首屏 SSR 与那个片段**共用** `src/lib/photo-card-render.ts`。
 *
 * 因此本文件锁的是三件事：
 * 1. 卡片标记（data-* 选择器）与 `upload.astro` 客户端脚本的预期完全对齐；
 * 2. 内联 onerror 里写死的那几个 id/选择器与页面结构对齐；
 * 3. 排序键（`[data-manage-date]` 的 `YYYY-MM-DD`）能被客户端直接拿来与输入框比较。
 * 任一处漂移，「不整页刷新」就会静默失效 —— 页面不报错，只是新卡长得不一样或排序错位。
 */
import { describe, expect, it } from 'vitest';
import { photoDateKey, renderManageCard, renderManageCards } from '../src/lib/photo-card-render';
import type { ManageCardPhoto } from '../src/lib/photo-card-render';

function photo(over: Partial<ManageCardPhoto> = {}): ManageCardPhoto {
  return {
    id: 'p-1',
    url: 'https://cdn.example.com/orig.jpg',
    thumbUrl: 'https://cdn.example.com/thumb.jpg',
    title: '海边',
    tags: ['风景', '旅行'],
    takenAt: new Date(2024, 4, 7, 12, 30), // 本地时间 2024-05-07
    ...over,
  };
}

describe('photoDateKey', () => {
  it('Date → 本地 YYYY-MM-DD（补零）', () => {
    expect(photoDateKey(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(photoDateKey(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('ISO 串与等价 Date 给出同一结果（服务端是 Date、客户端是串）', () => {
    const d = new Date(2024, 4, 7, 12, 30);
    expect(photoDateKey(d.toISOString())).toBe(photoDateKey(d));
  });

  it('非法输入 → 空串（<input type="date"> 不接受垃圾值）', () => {
    expect(photoDateKey('not-a-date')).toBe('');
  });

  it('与服务端 `dateKey` 的语义一致：用本地时区而非 UTC', () => {
    // 本地 00:30 的日期，若误用 UTC 在 UTC+8 会退到前一天
    const early = new Date(2024, 4, 7, 0, 30);
    expect(photoDateKey(early)).toBe('2024-05-07');
  });
});

describe('renderManageCard —— 标记契约（客户端脚本依赖的选择器）', () => {
  const html = renderManageCard(photo());

  it('根节点是 .manage-card 且带 data-photo-id', () => {
    expect(html).toContain('class="manage-card p-1"');
    expect(html).toContain('data-photo-id="p-1"');
  });

  it('缩略图优先，并带 data-broken-photo（孤儿图兜底靠它定位卡片）', () => {
    expect(html).toContain('src="https://cdn.example.com/thumb.jpg"');
    expect(html).toContain('data-broken-photo="p-1"');
  });

  it('无缩略图时回落到原图', () => {
    const h = renderManageCard(photo({ thumbUrl: null }));
    expect(h).toContain('src="https://cdn.example.com/orig.jpg"');
  });

  it('四个输入控件 + 两个按钮 + 勾选框的 data-* 全部齐备', () => {
    for (const sel of [
      'data-photo-check',
      'data-manage-date',
      'data-manage-title',
      'data-manage-tags',
      'data-save-photo="p-1"',
      'data-delete-photo="p-1"',
    ]) {
      expect(html, `缺少 ${sel}`).toContain(sel);
    }
  });

  it('勾选框 value = 照片 id（批量标签操作按 value 收集 id）', () => {
    expect(html).toContain('value="p-1"');
  });

  it('日期输入框的 value 是 YYYY-MM-DD（客户端排序直接做字典序比较）', () => {
    expect(html).toContain('data-manage-date');
    expect(html).toMatch(/data-manage-date[^>]*value="2024-05-07"|value="2024-05-07"[^>]*data-manage-date/);
  });

  it('标签以逗号拼接进 value（与 parseTagsInput 互为逆运算）', () => {
    expect(html).toContain('value="风景,旅行"');
  });

  it('无标题时 alt 回落到「照片」，标题输入框 value 为空', () => {
    const h = renderManageCard(photo({ title: '' }));
    expect(h).toContain('alt="照片"');
    expect(h).toMatch(/data-manage-title[^>]*value=""|value=""[^>]*data-manage-title/);
  });
});

describe('renderManageCard —— 转义', () => {
  it('标题中的 HTML 被转义，不会注入（也不能破坏属性边界）', () => {
    const h = renderManageCard(photo({ title: '<img src=x onerror=alert(1)>"&' }));
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain('&quot;&amp;');
  });

  it('标签与 id 同样转义', () => {
    const h = renderManageCard(photo({ id: 'a"b', tags: ['<x>'] }));
    expect(h).toContain('data-photo-id="a&quot;b"');
    expect(h).toContain('value="&lt;x&gt;"');
  });
});

describe('renderManageCard —— 内联 onerror 与页面结构对齐', () => {
  const html = renderManageCard(photo());

  it('onerror 存在（<img> 标签内联，CSP 之外的最先兜底）', () => {
    expect(html).toContain('onerror="');
  });

  it('onerror 引用的 id / 选择器与 upload.astro 的 DOM 一致', () => {
    // 计数徽标、空态文案、管理区容器 —— 三者任一改名，破图兜底就会静默失灵
    expect(html).toContain("getElementById('manage-photo-count')");
    expect(html).toContain("getElementById('manage-empty')");
    expect(html).toContain("querySelectorAll('[data-manage-area]')");
  });

  it('onerror 用 `hidden` class 切换而非 hidden 属性（网格是 display:grid，属性会被覆盖）', () => {
    expect(html).toContain("classList.add('hidden')");
    expect(html).toContain("classList.remove('hidden')");
  });

  it('onerror 自带 dataset.fallback 去重，避免重复摘卡', () => {
    expect(html).toContain("c.dataset.fallback='1'");
  });

  it('onerror 是单行合法 JS（属性值里不能出现裸换行）', () => {
    const m = html.match(/onerror="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('\n');
    expect(() => new Function(m![1]!)).not.toThrow();
  });
});

describe('renderManageCards', () => {
  it('空列表 → 空串（页面靠它渲染空网格，不需要额外分支）', () => {
    expect(renderManageCards([])).toBe('');
  });

  it('多张按传入顺序拼接（顺序由服务端 ORDER BY 决定）', () => {
    const html = renderManageCards([photo({ id: 'a' }), photo({ id: 'b' })]);
    expect(html.indexOf('data-photo-id="a"')).toBeLessThan(html.indexOf('data-photo-id="b"'));
    expect(html.match(/class="manage-card p-1"/g)).toHaveLength(2);
  });

  it('单张渲染 == 批量渲染的同元素（片段接口与首屏必须逐字节一致）', () => {
    const p = photo();
    expect(renderManageCards([p])).toBe(renderManageCard(p));
  });
});
