/** 诊断：反引号包裹的行内代码在管线中的输出 */
import { renderMdx } from '../src/lib/mdx';

const cases: Record<string, string> = {
  真实反引号: '这是一段 `测试一下` 的代码。',
  转义反引号: '这是转义反引号：\\`测试一下\\`',
  表格内代码: '| 快捷键 | 示例 |\n| --- | --- |\n| Ctrl/Cmd + E | `文本` |',
};

for (const [name, src] of Object.entries(cases)) {
  const { html } = await renderMdx(src);
  console.log(`=== ${name} ===`);
  console.log(html);
  console.log('');
}
