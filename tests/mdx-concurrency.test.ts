import { describe, expect, it } from 'vitest';
import { clearRenderCache, invalidateRenderCache, renderMdx } from '../src/lib/mdx';

describe('Markdown 并发渲染', () => {
  it('同一冷缓存内容只编译一次，所有请求共享结果', async () => {
    clearRenderCache();
    const results = await Promise.all(Array.from({ length: 8 }, () => renderMdx('## 并发正文\n\n公式 $x^2 + y^2 = 1$')));
    expect(results.every(result => result === results[0])).toBe(true);
  });
  it.each(['single', 'all'])('在编译期间失效（%s）后旧任务不能复活缓存', async (mode) => {
    clearRenderCache();
    const source = '## 编译期间失效\n\n正文';
    const first = renderMdx(source);
    if (mode === 'single') invalidateRenderCache(source);
    else clearRenderCache();
    const stale = await first;
    const fresh = await renderMdx(source);
    expect(fresh).not.toBe(stale);
    expect(await renderMdx(source)).toBe(fresh);
  });
  it('组件渲染失败后不缓存被拒绝的任务', async () => {
    clearRenderCache();
    const first = await renderMdx('<MissingComponent />').catch(e => e);
    const second = await renderMdx('<MissingComponent />').catch(e => e);
    expect(first).toBeInstanceOf(Error);
    expect(second).toBeInstanceOf(Error);
    expect(second).not.toBe(first);
  });
});
