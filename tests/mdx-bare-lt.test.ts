/**
 * 裸 `<` 兜底：标签名后继字符校验（回归测试）
 *
 * 背景（2026-09-21 实测）：桌面端文章《计算机组成》整篇 500，报
 * `Unexpected character \`。\` (U+3002) in name` —— 正文里写了
 * `当CF=1时，说明A<B。`，`<B` 被旧逻辑判为「合法标签起始」放行，
 * 随后 MDX JSX 解析器读到中文句号直接抛错，整篇渲染失败。
 *
 * 修法：看完首字符后继续读标签名，并校验其后继字符——
 * 只有空白 / `>` / `/` / 行尾才算真标签；中文标点等一律按裸 `<` 转义。
 */
import { describe, expect, it } from 'vitest';
import { renderMdx } from '../src/lib/mdx';

describe('裸 `<` 兜底（标签名后继校验）', () => {
  it('正文里的 `A<B。` 不再让整篇崩，且渲染为字面 <', async () => {
    const { html } = await renderMdx('当ZF=1时，说明A=B。当CF=1时，说明A<B。');
    expect(html).toContain('A&lt;B');
  });

  it('`<0`、`< n`、`<!` 等既有形态仍被安全化', async () => {
    const { html } = await renderMdx('数组下标 <0 是非法写法；比较 n<2 与 n< 2。');
    expect(html).toContain('&lt;0');
    expect(html).toContain('n&lt;2');
  });

  it('真正的标签继续正常解析（不被误转义）', async () => {
    // 小写 HTML 标签在 MDX 里原样输出；⚠️ 未注册的大写组件（如 <Tex/>）会报
    // 「Expected component ... to be defined」，那是 MDX 的正常行为，不作为本用例
    const { html } = await renderMdx('<div class="x">hi</div>\n\n换行<br/>');
    expect(html).toContain('<div class="x">hi</div>');
    expect(html).toContain('<br/>');
  });

  it('行内代码里的 `<` 原样保留', async () => {
    const { html } = await renderMdx('用 `A<B` 表示小于关系。');
    expect(html).toContain('A&lt;B');
  });

  it('中文标点的多种后继形态都能兜住', async () => {
    for (const src of ['A<B，继续', 'A<B。句号', 'A<B（括号）', 'A<B、顿号']) {
      await expect(renderMdx(src)).resolves.toBeTruthy();
    }
  });
});
