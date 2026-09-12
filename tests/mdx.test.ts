/**
 * MDX 渲染管线单元测试
 */
import { describe, expect, it } from 'vitest';
import {
  renderMdx,
  renderMarkdownHtml,
  normalizeMathFences,
  normalizeSource,
  encodeMarkLeadVariant,
  invalidateRenderCache,
  clearRenderCache,
} from '../src/lib/mdx';
import { buildTocTree, renderTocTreeHtml } from '../src/lib/toc-tree';

describe('renderMdx', () => {
  it('渲染 GFM 表格', async () => {
    const { html } = await renderMdx('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
  });

  it('将 :::note 指令转换为 Admonition 组件', async () => {
    const { html } = await renderMdx(':::note\nhello\n:::');
    expect(html).toContain('admonition-note');
    expect(html).toContain('hello');
  });

  it('将 > [!note] 转换为 Callout 组件（不可折叠）', async () => {
    const { html } = await renderMdx('> [!note]\n> 这是一条笔记');
    expect(html).toContain('callout-note');
    expect(html).toContain('这是一条笔记');
    // 未带 -/+ 时不渲染 details（不可折叠）
    expect(html).not.toContain('<details');
  });

  it('Callout 支持空格分隔的自定义标题', async () => {
    const { html } = await renderMdx('> [!tip] 部署提示\n> 记得先构建');
    expect(html).toContain('callout-tip');
    expect(html).toContain('部署提示');
    expect(html).not.toContain('callout-tip-icon');
  });

  it('Callout 支持紧贴式自定义标题（中括号写法）', async () => {
    const { html } = await renderMdx('> [!warning]【重要】检查配置\n> 正文内容');
    expect(html).toContain('callout-warning');
    expect(html).toContain('【重要】检查配置');
  });

  it('> [!note]- 默认折叠（details 无 open，且仅标题可见）', async () => {
    const { html } = await renderMdx('> [!note]- 折叠标题\n> 隐藏的正文');
    expect(html).toContain('<details');
    expect(html).toContain('callout-foldable');
    expect(html).toContain('折叠标题');
    expect(html).toContain('隐藏的正文'); // 内容仍在 DOM 中（details 原生隐藏）
    // 折叠态不得带 open 属性
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('> [!note]+ 默认展开（details 带 open）', async () => {
    const { html } = await renderMdx('> [!example]+ 展开标题\n> 可见正文');
    expect(html).toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('callout-example');
  });

  it('Callout 类型别名归一（hint → tip，caution → warning）', async () => {
    const hint = await renderMdx('> [!hint]\n> x');
    expect(hint.html).toContain('callout-tip');
    const caution = await renderMdx('> [!caution]\n> x');
    expect(caution.html).toContain('callout-warning');
  });

  it('未知 Callout 类型降级为 note', async () => {
    const { html } = await renderMdx('> [!nonexistent]\n> x');
    expect(html).toContain('callout-note');
  });

  it('Callout 内保留嵌套引用（题干 + 解析结构）', async () => {
    const src = [
      '> [!example]- **【例 5.1】** 设 $\\lambda$ 是矩阵 $A$ 的特征值。',
      '> > **解析**：利用特征值映射表求解。',
    ].join('\n');
    const { html } = await renderMdx(src);
    expect(html).toContain('callout-example');
    expect(html).toContain('<details');
    expect(html).toContain('【例 5.1】');
    expect(html).toContain('<blockquote');
    expect(html).toContain('解析');
  });

  it('Callout 富文本标题：加粗保留、公式在 <summary> 内渲染、前缀被剥离', async () => {
    const src = '> [!example]- **【例 5.1】** 设 $\\lambda$ 是特征值。\n> > **解析**：略。';
    const { html } = await renderMdx(src);
    // 标题在 summary 内，且含加粗与 KaTeX（公式已渲染，不是原始 $…$）
    const summary = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(summary).toContain('<strong>【例 5.1】</strong>');
    expect(summary).toContain('class="katex"');
    expect(summary).not.toContain('$\\lambda$');
    // `[!example]-` 前缀不得出现在标题里
    expect(summary).not.toContain('[!example]');
    // 标题行的 P 标签被抽走，不在 body 里重复出现
    expect(html).not.toContain('data-callout-head');
  });

  it('Callout 标题含下划线公式不被误当斜体标记', async () => {
    const src = '> [!note] 矩阵 $A^{-1}$ 的逆\n> 正文';
    const { html } = await renderMdx(src);
    // 非折叠块标题在 <div class="callout-title"> 内
    const titleHtml = html.match(/<div class="callout-title">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(titleHtml).toContain('class="katex"');
    const annotation = titleHtml.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/)?.[1] ?? '';
    expect(annotation).toContain('A^{-1}');
    // 不应出现被斜体规则吃掉的 <em>
    expect(titleHtml).not.toContain('<em>');
    // 正文正常
    expect(html).toContain('正文');
  });

  it('Callout 内的 LaTeX 公式正常渲染为 KaTeX', async () => {
    const { html } = await renderMdx('> [!note]\n> 公式 $E = mc^2$ 行内测试');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('$E = mc^2$');
  });

  it('普通引用块不受影响（回归）', async () => {
    const { html } = await renderMdx('> 这只是一段普通引用\n> 没有 callout 标注');
    expect(html).toContain('<blockquote');
    expect(html).not.toContain('callout-');
    expect(html).toContain('这只是一段普通引用');
  });

  it('以 [! 开头但不是合法类型时不误伤', async () => {
    const { html } = await renderMdx('> [!这不是类型]\n> 内容');
    expect(html).not.toContain('callout-note');
  });

  // 回归：walk 必须先递归 body 再 push 进 jsxChildren，否则嵌套 Callout 丢失
  it('callout 内嵌套 callout（递归转换）', async () => {
    const { html } = await renderMdx(
      '> [!info] 外层\n> 外层内容。\n> > [!tip] 内层\n> > 内层内容。',
    );
    expect(html.match(/class="callout /g)?.length).toBe(2);
    expect(html).toContain('data-callout="info"');
    expect(html).toContain('data-callout="tip"');
    // 内层不应残留字面量 [!tip]
    expect(html).not.toContain('[!tip]');
    expect(html).toContain('内层内容。');
  });

  it('callout 内保留普通引用块（只转 callout）', async () => {
    const { html } = await renderMdx('> [!note] 外层\n> 正文\n> > 普通引用\n> > 保留原样');
    expect(html.match(/class="callout /g)?.length).toBe(1);
    expect(html).toContain('<blockquote');
    expect(html).toContain('普通引用');
  });

  it('为代码块添加行号', async () => {
    const { html } = await renderMdx('```ts\nconst a = 1;\n```');
    expect(html).toContain('line-number');
  });

  it('从 h2/h3 提取目录', async () => {
    const { toc } = await renderMdx('## Alpha\n### Beta\n## Gamma');
    expect(toc.map((t) => t.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('将全角反引号（U+FF40）规范化为行内代码', async () => {
    const { html } = await renderMdx('使用 ｀Alt｀ 键切换');
    expect(html).toContain('<code>Alt</code>');
    expect(html).not.toContain('｀');
  });

  it('将修饰符重音符（U+02CB）与反向撇号（U+2035）规范化', async () => {
    const { html } = await renderMdx('a ˋbˋ c ‵d‵');
    expect(html).toContain('<code>b</code>');
    expect(html).toContain('<code>d</code>');
    expect(html).not.toContain('ˋ');
    expect(html).not.toContain('‵');
  });

  it('ASCII 反引号渲染不受影响', async () => {
    const { html } = await renderMdx('使用 `Alt` 键切换');
    expect(html).toContain('<code>Alt</code>');
  });

  it('渲染行内 LaTeX 公式（$...$）', async () => {
    const { html } = await renderMdx('质能方程 $E = mc^2$ 很有名。');
    expect(html).toContain('class="katex"');
    expect(html).toContain('E');
    // 原始 $ 定界符不应残留在输出里
    expect(html).not.toContain('$E = mc^2$');
  });

  it('渲染独立 LaTeX 公式块（$$...$$）', async () => {
    const { html } = await renderMdx('$$\n\\int_0^\\infty e^{-x}\\,dx = 1\n$$');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
  });

  it('代码块内的 $ 不被当作公式定界符', async () => {
    const { html } = await renderMdx('```bash\necho $HOME\n```');
    expect(html).not.toContain('katex');
    expect(html).toContain('$HOME');
  });

  it('表格单元格内的 $|A| \\neq 0$ 不产生 \\vertA 红字（回归：| → \\vert 需带边界空格）', async () => {
    const { html } = await renderMdx('| 条件 | 含义 |\n| --- | --- |\n| $|A| \\neq 0$ | 可逆 |');
    // tableLineToSafe 把 | 替换为 \vert 时必须留词法边界，
    // 否则 \vertA 成为未定义控制词 → KaTeX 红字回显源码
    expect(html).not.toContain('vertA');
    expect(html).not.toContain('katex-error');
    // 不等号在 MathML 层为单字形 ≠
    expect(html).toContain('≠');
  });

  it('KaTeX 输出类名与 katex.min.css 版本一致（回归：内部类须为 katex- 前缀）', async () => {
    const { html } = await renderMdx('设 $a \\neq b$ 成立。');
    // katex ≥0.18 内部类带 katex- 前缀且 CSS 不再含旧无前缀类；
    // 若 HTML 出现裸 base/strut（0.16 输出）而页面加载 0.18 CSS，
    // \not= 斜线覆盖层定位失效 → 不等号平铺成 "/="
    expect(html).toContain('katex-strut');
    expect(html).not.toMatch(/class="(base|strut|vbox|thinbox)"/);
  });
});

describe('荧光高亮：==文本== → <Mark>', () => {
  it('默认高亮（primary，不带 variant 属性）', async () => {
    const { html } = await renderMdx('这里是 ==重点内容== 的部分。');
    expect(html).toContain('class="mark mark-primary"');
    expect(html).toContain('data-mark="primary"');
    expect(html).toContain('重点内容');
    expect(html).not.toContain('==');
  });

  it('后缀语义色修饰符', async () => {
    const { html } = await renderMdx('==次要=={.secondary} ==第三=={.tertiary} ==错误=={.error} ==建议=={.tip}');
    expect(html).toContain('mark-secondary');
    expect(html).toContain('mark-tertiary');
    expect(html).toContain('mark-error');
    expect(html).toContain('mark-tip');
    expect(html).not.toContain('{.');
  });

  it('后缀省略点号亦可识别', async () => {
    const { html } = await renderMdx('==提示内容=={tip}');
    expect(html).toContain('mark-tip');
    expect(html).not.toContain('{tip}');
  });

  it('前缀简写写法 ==tip:文本==', async () => {
    const { html } = await renderMdx('==tip:记得先备份== 收尾。');
    expect(html).toContain('mark-tip');
    expect(html).toContain('记得先备份');
    expect(html).not.toContain('==');
    expect(html).not.toContain('tip:');
  });

  it('别名归一（warn→error / info→tip / main→primary）', async () => {
    const err = await renderMdx('==注意=={.warn}');
    expect(err.html).toContain('mark-error');
    const tip = await renderMdx('==注意=={.info}');
    expect(tip.html).toContain('mark-tip');
    const pri = await renderMdx('==注意=={.main}');
    expect(pri.html).toContain('mark-primary');
  });

  it('行内强调可嵌套进高亮（跨节点配对）', async () => {
    const { html } = await renderMdx('==外层 **加粗** 与 *斜体* 都在里面==');
    expect(html).toContain('class="mark mark-primary"');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).not.toContain('==');
  });

  it('同一文本节点内多组高亮', async () => {
    const { html } = await renderMdx('==第一处== 与 ==第二处== 与 ==第三处=={.tip}');
    expect(html.match(/class="mark mark-/g)?.length).toBe(3);
    expect(html).toContain('第一处');
    expect(html).toContain('第二处');
    expect(html).toContain('第三处');
  });

  it('高亮可跨软换行（同行内多节点配对）', async () => {
    const { html } = await renderMdx('前段。==高亮开始\n继续高亮==。后段。');
    expect(html).toContain('mark-primary');
    expect(html).toContain('高亮开始');
    expect(html).toContain('继续高亮');
  });

  it('行内代码内不触发渲染（屏障）', async () => {
    const { html } = await renderMdx('写作 `==字面量标记语法==` 即可。');
    expect(html).toContain('==字面量标记语法==');
    expect(html).not.toContain('class="mark');
  });

  it('围栏代码块内不触发渲染（屏障）', async () => {
    const src = '讲解示例：\n\n```md\n==这是示例高亮=={.tip}\n```\n';
    const { html } = await renderMdx(src);
    expect(html).toContain('==这是示例高亮=={.tip}');
    expect(html).not.toContain('class="mark');
  });

  it('未闭合的 == 保守还原为原文', async () => {
    const { html } = await renderMdx('这里的 ==没有闭合 就结束了。');
    // MDX 会在文本节点边界插入 `<!-- -->` 分隔注释，断言允许其存在
    expect(html).toMatch(/==(<!-- -->)?没有闭合 就结束了。/);
    expect(html).not.toContain('class="mark');
  });

  it('未闭合的前缀写法也保守还原（含前缀原文）', async () => {
    const { html } = await renderMdx('==tip:没写完');
    expect(html).toMatch(/==tip:(<!-- -->)?没写完/);
    expect(html).not.toContain('class="mark');
  });

  it('转义的 \\=\\= 输出字面量', async () => {
    const { html } = await renderMdx('转义写法 \\=\\=字面量\\=\\= 不渲染。');
    expect(html).toContain('==字面量==');
    expect(html).not.toContain('class="mark');
  });

  it('非法后缀名不误伤（保留字面量）', async () => {
    const { html } = await renderMdx('==内容=={.notavariant}');
    expect(html).toContain('mark-primary');
    // 非法后缀原样保留在文本里（不被静默吞掉）
    expect(html).toContain('{.notavariant}');
  });

  it('冒号前不是合法变体名时不误判前缀', async () => {
    const { html } = await renderMdx('==注意：这里是重点==');
    expect(html).toContain('mark-primary');
    expect(html).toContain('注意：这里是重点');
  });

  it('标题与表格单元格内同样生效', async () => {
    const h = await renderMdx('## 标题里的 ==高亮==');
    expect(h.html).toContain('mark-primary');
    const t = await renderMdx('| a | b |\n| --- | --- |\n| ==单元== | x |');
    expect(t.html).toContain('mark-primary');
    expect(t.html).toContain('单元');
  });

  it('Callout 标题行与正文内均生效', async () => {
    const { html } = await renderMdx('> [!tip] ==高亮标题==\n> 正文里也有 ==高亮内容=={.tip}');
    expect(html).toContain('mark-primary');
    expect(html).toContain('mark-tip');
    expect(html).toContain('高亮标题');
    expect(html).toContain('高亮内容');
  });

  it('列表项与引用块内生效', async () => {
    const li = await renderMdx('- 第一项 ==高亮=='.repeat(1));
    expect(li.html).toContain('mark-primary');
    const bq = await renderMdx('> 引用里的 ==高亮=={.error}');
    expect(bq.html).toContain('mark-error');
  });

  it('高亮内的行内代码保留为 <code>', async () => {
    const { html } = await renderMdx('==请在 `npm install` 后重试=={.tip}');
    expect(html).toContain('mark-tip');
    expect(html).toContain('<code>npm install</code>');
  });
});

describe('目录：层级、KaTeX 与树形渲染', () => {
  it('从 h2/h3/h4 提取目录（h4 亦采集）', async () => {
    const { toc } = await renderMdx('## A\n### B\n#### C\n## D');
    expect(toc.map((t) => t.level)).toEqual([2, 3, 4, 2]);
    expect(toc.map((t) => t.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('标题含 LaTeX 时 html 字段带 KaTeX 标记、text 为 LaTeX 源码', async () => {
    const { toc } = await renderMdx('## 范德蒙行列式 $V_n$ 的性质\n### 展开 $D_n = \\prod$');
    expect(toc).toHaveLength(2);
    expect(toc[0]!.html).toContain('class="katex"');
    expect(toc[0]!.text).toContain('V_n');
    expect(toc[0]!.text).not.toContain('$'); // $ 定界符不残留
    expect(toc[1]!.html).toContain('class="katex"');
  });

  it('纯文本标题 html 字段为普通标记（无 katex）', async () => {
    const { toc } = await renderMdx('## 普通标题');
    expect(toc[0]!.html).toContain('普通标题');
    expect(toc[0]!.html).not.toContain('katex');
  });

  it('buildTocTree：扁平 → 嵌套树（跳级挂最近浅级）', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 3 },
      { id: 'c', text: 'C', level: 4 },
      { id: 'd', text: 'D', level: 2 },
    ]);
    expect(tree.map((n) => n.item.id)).toEqual(['a', 'd']);
    expect(tree[0]!.children.map((n) => n.item.id)).toEqual(['b']);
    expect(tree[0]!.children[0]!.children.map((n) => n.item.id)).toEqual(['c']);
    expect(tree[1]!.children).toHaveLength(0);
  });

  it('renderTocTreeHtml：有子级才有折叠按钮，层级类名正确', () => {
    const out = renderTocTreeHtml([
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 3 },
      { id: 'd', text: 'D', level: 2 },
    ]);
    expect(out).toContain('toc-node');
    expect(out).toContain('data-doc-anchor');
    expect(out).toContain('toc-l2');
    expect(out).toContain('toc-l3');
    // A 节点带折叠按钮；叶子 B/D 用占位符
    expect((out.match(/class="toc-fold"/g) ?? []).length).toBe(1);
    expect(out).toContain('toc-fold-spacer');
    expect(out).toContain('href="#a"');
    expect(out).toContain('href="#b"');
  });

  it('renderTocTreeHtml：KaTeX html 字段注入，纯文本转义', () => {
    const out = renderTocTreeHtml([
      { id: 'a', text: 'A <对比>', level: 2, html: '<span class="katex">x</span>' },
      { id: 'b', text: 'B <对比>', level: 2 },
    ]);
    expect(out).toContain('<span class="katex">x</span>'); // html 原样注入
    expect(out).toContain('B &lt;对比&gt;'); // text 转义
    expect(out).not.toContain('>B <对比><'); // 未转义原文不出现
  });
});

/**
 * renderMarkdownHtml —— 动态（moments）正文渲染的同一轻量 GFM 管线。
 * 与列表 / load-more / 预览共用此实现，故此处锁定其契约：
 * GFM 语法生效、原始 HTML 不注入（XSS 安全）、空串输出空 HTML。
 */
describe('renderMarkdownHtml', () => {
  it('渲染粗体与行内代码', async () => {
    const html = await renderMarkdownHtml('**你好** 与 `code`');
    expect(html).toContain('<strong>你好</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('渲染列表与链接', async () => {
    const html = await renderMarkdownHtml('- 第一项\n- 第二项\n\n[官网](https://example.com)');
    expect(html).toContain('<li>第一项</li>');
    expect(html).toContain('href="https://example.com"');
  });

  it('渲染 GFM 表格', async () => {
    const html = await renderMarkdownHtml('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  it('原始 HTML 不注入（标签被剥离，只保留纯文本）', async () => {
    // 无 rehype-raw：脚本块被整体丢弃 → 绝不输出可执行脚本
    const script = await renderMarkdownHtml('<script>alert(1)</script>');
    expect(script).not.toContain('<script>');
    expect(script).not.toContain('alert(1)');
    // 行内 HTML 标签同样被剥离，仅保留文本，事件属性不会外泄
    const inline = await renderMarkdownHtml('a <b onclick="x">bold</b> c');
    expect(inline).not.toContain('<b');
    expect(inline).not.toContain('onclick');
    expect(inline).toContain('bold');
  });

  it('空内容输出空（或空白）', async () => {
    expect(await renderMarkdownHtml('')).toBe('');
    expect((await renderMarkdownHtml('   ')).trim()).toBe('');
  });
});

/**
 * 折叠面板 `:::collapse` —— 对齐 VuePress Plume 主题语法
 *
 * 语法规则：
 * - 容器内**恰好一个顶层无序列表**，每项 = 一个面板；
 * - 列表项内「首行到首个空行」= 标题，首个空行之后 = 正文（完整块级 Markdown）；
 * - `:+` / `:-` 标记该项初始展开 / 折叠；
 * - `accordion` 整组互斥（HTML `<details name>`）；
 * - `expand` 整组默认展开；
 * - 默认（无参数）全部折叠。
 */
describe('折叠面板 :::collapse', () => {
  it('基本形态：默认全部折叠，标题与正文正确拆分', async () => {
    const { html } = await renderMdx(
      ':::collapse\n\n- 第一个面板标题\n\n  第一个面板的正文内容。\n\n- 第二个面板标题\n\n  第二个面板正文。\n\n:::\n',
    );
    expect(html).toContain('class="md-collapse"');
    expect(html).toContain('md-collapse-panel');
    expect(html).toContain('第一个面板标题');
    expect(html).toContain('第一个面板的正文内容。');
    expect(html).toContain('第二个面板正文。');
    // 默认折叠：所有面板都不带 open
    expect(html).not.toContain('<details class="md-collapse-panel" open');
    // 语法本身不残留
    expect(html).not.toContain(':::collapse');
    // 两个面板
    expect(html.match(/md-collapse-panel"/g)?.length).toBe(2);
  });

  it('空格参数 `accordion` 被正确识别（图片写法）', async () => {
    const { html } = await renderMdx(
      ':::collapse accordion\n\n- :+ 第一个面板标题\n\n  第一个面板的正文内容。\n\n- 第二个带 `code` 的标题\n\n  第二个面板的正文内容。\n\n:::\n',
    );
    expect(html).toContain('data-collapse-accordion="true"');
    // 手风琴：所有面板共享同一个 name 值
    const names = [...html.matchAll(/name="(collapse-group-[^"]*)"/g)].map((m) => m[1]);
    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(1);
    // `:+` 标记项初始展开
    expect(html).toContain('open');
    expect(html).toContain('第一个面板标题');
    // 标记字符本身不出现
    expect(html).not.toContain(':+');
  });

  it('`expand` 整组默认展开', async () => {
    const { html } = await renderMdx(
      ':::collapse expand\n\n- 标题一\n\n  正文一\n\n- 标题二\n\n  正文二\n\n:::\n',
    );
    const opens = html.match(/<details class="md-collapse-panel" open/g);
    expect(opens?.length).toBe(2);
    // 非手风琴：不带 name
    expect(html).not.toContain('name="collapse-group-');
  });

  it('`:-` 在 expand 整组展开时把单项压回折叠', async () => {
    const { html } = await renderMdx(
      ':::collapse expand\n\n- 标题一\n\n  正文一\n\n- :- 强制折叠\n\n  正文二\n\n:::\n',
    );
    const opens = html.match(/<details class="md-collapse-panel" open/g);
    expect(opens?.length).toBe(1);
    expect(html).toContain('强制折叠');
    expect(html).not.toContain(':-');
  });

  it('`accordion expand` 组合：互斥 + 默认展开', async () => {
    const { html } = await renderMdx(
      ':::collapse accordion expand\n\n- 标题一\n\n  正文一\n\n- 标题二\n\n  正文二\n\n:::\n',
    );
    expect(html).toContain('data-collapse-accordion="true"');
    expect(html.match(/<details class="md-collapse-panel" open/g)?.length).toBe(2);
  });

  it('标题支持行内富文本（加粗 / 行内代码）', async () => {
    const { html } = await renderMdx(
      ':::collapse expand\n\n- 标题含 **加粗** 与 `code`\n\n  正文\n\n:::\n',
    );
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('正文支持完整块级 Markdown（引用 / 代码块 / 列表 / 公式）', async () => {
    const { html } = await renderMdx(
      ':::collapse expand\n\n- 富正文面板\n\n  > 引用一段话\n\n  ```js\n  const a = 1;\n  ```\n\n  - 子项 A\n  - 子项 B\n\n  行内 $E=mc^2$ 公式。\n\n:::\n',
    );
    expect(html).toContain('<blockquote');
    expect(html).toContain('language-js');
    expect(html).toContain('子项 A');
    expect(html).toContain('katex');
  });

  it('非法形态（容器内无列表）→ 原样保留，不吞内容', async () => {
    const { html } = await renderMdx(':::collapse\n\n这里只是一段普通文字，没有列表。\n\n:::\n');
    // 不产出组件，但文本仍在（降级为普通段落）
    expect(html).not.toContain('md-collapse-panel');
    expect(html).toContain('这里只是一段普通文字');
  });

  it('围栏代码块内的 ::collapse 示例原样保留（不被解析）', async () => {
    const { html } = await renderMdx('```md\n:::collapse accordion\n\n- 标题\n\n:::\n```\n');
    expect(html).not.toContain('md-collapse-panel');
    expect(html).toContain(':::collapse');
  });

  it('同页多组手风琴互不干扰（name 值不同）', async () => {
    const { html } = await renderMdx(
      ':::collapse accordion\n\n- A1\n\n  a\n\n:::\n\n:::collapse accordion\n\n- B1\n\n  b\n\n:::\n',
    );
    const names = [...new Set([...html.matchAll(/name="(collapse-group-[^"]*)"/g)].map((m) => m[1]))];
    expect(names.length).toBe(2);
  });
});

/**
 * 选项卡组 `:::tabs#id` + `@tab` —— 对齐 VuePress Plume 主题语法
 *
 * 语法规则：
 * - `:::tabs#稳定标识` 开启容器（`#` 后为跨组联动用的稳定标识，可省略）；
 * - 每个 `@tab[:active] 标签[#锚点]` 开启一个选项卡；
 * - `:active` 指定初始激活（同组多个只取第一个）；
 * - 标签支持行内 Markdown，尾部 `#锚点` 从可见标题剥离；
 * - 每个分区内容支持完整块级 Markdown；
 * - 少于 2 个分区 / 格式不完整 → 降级为普通 Markdown。
 */
describe('选项卡组 :::tabs', () => {
  it('基本形态：容器、按钮、面板结构正确', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm\n\n使用 npm 安装。\n\n@tab pnpm\n\n使用 pnpm 安装。\n\n:::\n',
    );
    expect(html).toContain('class="md-tabs"');
    expect(html).toContain('data-tabs-stable-id="pkg"');
    expect(html).toContain('role="tablist"');
    // 两个选项卡按钮
    expect(html.match(/role="tab"/g)?.length).toBe(2);
    // 标签文本正确
    expect(html).toContain('>npm<');
    expect(html).toContain('>pnpm<');
    // 语法本身不残留
    expect(html).not.toContain(':::tabs');
    expect(html).not.toContain('@tab');
  });

  it('未标记 :active 时默认激活第一个选项卡', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm\n\n正文一\n\n@tab pnpm\n\n正文二\n\n:::\n',
    );
    const selected = [...html.matchAll(/aria-selected="true"/g)];
    expect(selected.length).toBe(1);
    // 第一个按钮 aria-selected=true：出现在 npm 标签之后
    const idxNpm = html.indexOf('>npm<');
    const idxSelected = html.indexOf('aria-selected="true"');
    expect(idxSelected).toBeLessThan(idxNpm);
  });

  it('`@tab:active` 指定初始激活项，且不改动可见标题', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm\n\n正文一\n\n@tab:active pnpm\n\n正文二\n\n:::\n',
    );
    // 第二个按钮（pnpm）为选中态
    expect(/<button[^>]*aria-selected="true"[^>]*>[\s\S]{0,80}?pnpm/.test(html)).toBe(true);
    // 第一个按钮（npm）为未选中态
    expect(/<button[^>]*aria-selected="false"[^>]*>[\s\S]{0,80}?npm/.test(html)).toBe(true);
    // `:active` 标记不泄漏到标题
    expect(html).not.toContain(':active');
    expect(html).not.toContain('@tab');
  });

  it('标签尾部的 `#锚点` 被剥离，不进入可见标题', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm#npm\n\n正文一\n\n@tab:active **pnpm**#pnpm-core\n\n正文二\n\n:::\n',
    );
    expect(html).toContain('>npm<');
    expect(html).not.toContain('npm#npm');
    expect(html).not.toContain('pnpm-core<');
    // 但锚点写进了 data 属性（跨组联动对齐用）
    expect(html).toContain('data-tab-anchor="pnpm-core"');
    expect(html).toContain('data-tab-panel-anchor="pnpm-core"');
  });

  it('标签支持行内 Markdown（加粗 / 行内代码）', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab **npm**\n\n正文一\n\n@tab `pnpm`\n\n正文二\n\n:::\n',
    );
    expect(html).toContain('<strong>npm</strong>');
    expect(html).toContain('<code>pnpm</code>');
  });

  it('分区内容支持完整块级 Markdown（代码块 / 列表 / 引用）', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm\n\n```bash\nnpm install\n```\n\n@tab pnpm\n\n- 子项 A\n- 子项 B\n\n:::\n',
    );
    expect(html).toContain('language-bash');
    expect(html).toContain('子项 A');
  });

  it('每个分区的正文彼此独立（不串区）', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab A\n\n甲区内容。\n\n@tab B\n\n乙区内容。\n\n:::\n',
    );
    const firstPanel = html.slice(html.indexOf('md-tabs-panel'), html.indexOf('md-tabs-panel', html.indexOf('md-tabs-panel') + 1));
    expect(firstPanel).toContain('甲区内容。');
    expect(firstPanel).not.toContain('乙区内容。');
  });

  it('少于 2 个分区（仅 1 个 @tab）→ 降级为普通 Markdown，内容不丢', async () => {
    const { html } = await renderMdx(':::tabs#pkg\n\n@tab npm\n\n只有一条。\n\n:::\n');
    expect(html).not.toContain('md-tabs');
    expect(html).toContain('只有一条。');
  });

  it('容器内没有任何 @tab → 降级为普通 Markdown，内容不丢', async () => {
    const { html } = await renderMdx(':::tabs#pkg\n\n这里没有分区。\n\n:::\n');
    expect(html).not.toContain('md-tabs');
    expect(html).toContain('这里没有分区。');
  });

  it('围栏代码块内的 :::tabs 示例原样保留（不被解析）', async () => {
    const { html } = await renderMdx('```md\n:::tabs#pkg\n\n@tab npm\n\n正文\n\n:::\n```\n');
    expect(html).not.toContain('md-tabs');
    expect(html).toContain(':::tabs#pkg');
  });

  it('无 `#标识` 时容器仍然可用（不带跨组联动）', async () => {
    const { html } = await renderMdx(':::tabs\n\n@tab A\n\n甲\n\n@tab B\n\n乙\n\n:::\n');
    expect(html).toContain('class="md-tabs"');
    expect(html).not.toContain('data-tabs-stable-id');
  });

  it('同页多组选项卡各自独立，稳定标识不同', async () => {
    const { html } = await renderMdx(
      ':::tabs#a\n\n@tab A1\n\n甲一\n\n@tab A2\n\n甲二\n\n:::\n\n:::tabs#b\n\n@tab B1\n\n乙一\n\n@tab B2\n\n乙二\n\n:::\n',
    );
    expect(html).toContain('data-tabs-stable-id="a"');
    expect(html).toContain('data-tabs-stable-id="b"');
    expect(html.match(/class="md-tabs"/g)?.length).toBe(2);
  });

  it('同页同标识的两组共享同一 stableId（前端据此联动）', async () => {
    const { html } = await renderMdx(
      ':::tabs#pkg\n\n@tab npm\n\n甲\n\n@tab pnpm\n\n乙\n\n:::\n\n:::tabs#pkg\n\n@tab npm\n\n丙\n\n@tab pnpm\n\n丁\n\n:::\n',
    );
    expect(html.match(/data-tabs-stable-id="pkg"/g)?.length).toBe(2);
  });
});

/**
 * 裸 `<` 安全化：正文里的数学不等式（`<0.5`、`<25`）曾让 MDX JSX 解析器崩溃。
 *
 * 事故（2026-09-11）：文档正文写「多余位 <0.5 舍去」→ micromark-extension-mdx-jsx
 * 抛 `Unexpected character '0' (U+0030) before name` → 整篇 evaluate 失败。
 * 表格行由 tableLineToSafe 早有防护，普通段落 / 引用 / callout 内没有。
 */
describe('裸 `<` 安全化（escapeBareLt）', () => {
  it('正文中的 `<0.5` 不再崩溃，且渲染为字面 `<0.5`', async () => {
    const { html } = await renderMdx('多余位 <0.5 舍去。');
    expect(html).toContain('&lt;0.5');
    expect(html).toContain('舍去');
  });

  it('引用块 / Callout 内的 `<0.5` 同样安全', async () => {
    const { html } = await renderMdx('> [!example] 舍入\n> 多余位 >0.5 进位、<0.5 舍去。');
    expect(html).toContain('&lt;0.5');
    expect(html).toContain('callout');
  });

  it('`<0`、`<25`、`<!` 等崩溃形态均被安全化', async () => {
    for (const src of ['a <0 b', '阶差 <25 时吞尾数', 'a <! b', 'a <= b']) {
      await expect(renderMdx(src)).resolves.toBeTruthy();
    }
    const { html } = await renderMdx('阶差 <25 时吞尾数');
    expect(html).toContain('&lt;25');
  });

  it('合法 JSX 标签不被误伤（开 / 闭 / 自闭 / fragment）', async () => {
    // Callout 是注册表内组件：能渲染出 aside.callout 即证明标签未被转义成文本
    const a = await renderMdx('正文 <Callout type="note">内容</Callout> 结尾。');
    expect(a.html).toContain('class="callout');
    expect(a.html).not.toContain('&lt;Callout');
    // 闭合标签的 `/` 不得被误转义（历史 bug：</Tex> 曾变成 <\</Tex>）
    expect(a.html).not.toContain('<\\');
  });

  it('`<` 后跟空白保持原样（非标签形态，且渲染等价）', async () => {
    const { html } = await renderMdx('若 a < b 则成立');
    expect(html).toContain('a &lt; b');
  });

  it('归一化对 `<` + 空白/字母不做处理（留给 MDX 当标签解析）', () => {
    // 设计取舍：`<x` 无法与真实 JSX 组件区分，故不转义；
    // 数学表达式请写进 `$…$` 公式区（如 `$a<b$`），走 math 节点不经 JSX 解析。
    expect(normalizeMathFences('a < b')).toBe('a < b');
    expect(normalizeMathFences('a <x b')).toBe('a <x b');
  });

  it('归一化幂等：重复调用不叠加反斜杠', async () => {
    const once = normalizeMathFences('多余位 <0.5 舍去');
    const twice = normalizeMathFences(once);
    expect(twice).toBe(once);
    expect(once).toContain('\\<0.5');
  });

  it('代码区域不受影响（围栏 / 行内代码内的 `<0` 字面保留）', async () => {
    const { html } = await renderMdx('```\na <0 b\n```');
    expect(html).toContain('&lt;0');
  });
});

/**
 * 数学区外裸花括号安全化：MDX 把裸 `{` 当 JS 表达式交给 acorn，
 * `{.tip}` / `{2a}` 这类非合法 JS 会抛 `Could not parse expression with acorn`。
 *
 * 事故（2026-09-11）：文档在**引用块内写 display 数学**（`> $$…\frac{n}{2}…$$`），
 * normalizeMathFences 为满足 remark-math 的 fence 语法把 `$$` 拆成独占行，
 * 拆完该段的 `$` 消失 → `\frac{n}{2}` 的花括号落到「数学区外」→ 整篇 500。
 * 表格行由 tableLineToSafe 早有防护，非表格行当时只保护了 `<`。
 */
describe('裸花括号安全化（escapeBareBraces）', () => {
  it('数学区外的 `{.tip}` 不再崩溃，且渲染为字面 `{.tip}`', async () => {
    const { html } = await renderMdx('a {.tip} b');
    expect(html).toContain('{.tip}');
  });

  it('中文正文中的裸花括号安全', async () => {
    const { html } = await renderMdx('中文 {.tip} 中文');
    expect(html).toContain('{.tip}');
  });

  it('裸 `{2a}`（曾被 acorn 当数字+标识符）安全', async () => {
    const { html } = await renderMdx('公式 {2a} 说明');
    expect(html).toContain('{2a}');
  });

  it('引用块内 display 数学拆行后完整保留花括号（不转义，KaTeX 正常）', async () => {
    const { html } = await renderMdx('> $$t = 1 + 2 + \\cdots + \\frac{n}{2} = n$$');
    // KaTeX 正常渲染（无红字错误）
    expect(html).toContain('katex');
    expect(html).not.toContain('katex-error');
    // 关键：TeX 源码里的 `\frac{n}{2}` 花括号必须原样，不能被转义成 `\frac\{n\}\{2\}`
    const tex = [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)]
      .map((m) => m[1])
      .join('\n');
    expect(tex).toContain('\\frac{n}{2}');
    expect(tex).not.toContain('\\frac\\{');
  });

  it('行内 `$…$` 的花括号保留（不误伤 KaTeX 参数边界）', async () => {
    const { html } = await renderMdx('求和 $\\frac{n}{2}$ 即可');
    expect(html).toContain('katex');
    expect(html).not.toContain('katex-error');
    const tex = [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)]
      .map((m) => m[1])
      .join('\n');
    expect(tex).toContain('\\frac{n}{2}');
  });

  it('归一化幂等：重复调用不叠加反斜杠', () => {
    const once = normalizeMathFences('a {.tip} b');
    const twice = normalizeMathFences(once);
    expect(twice).toBe(once);
    expect(once).toContain('\\{.tip\\}');
  });

  it('代码区域不受影响（围栏 / 行内代码内的 `{.tip}` 字面保留）', async () => {
    const { html } = await renderMdx('```\na {.tip} b\n```');
    expect(html).toContain('{.tip}');
  });

  it('普通长度代码块照常高亮（P3-4 回归护栏）', async () => {
    const { html } = await renderMdx('```ts\nconst a: number = 1;\n```');
    expect(html).toContain('token');
    expect(html).not.toContain('data-code-plain');
  });

  it('超长代码块跳过高亮但内容不丢（P3-4）', async () => {
    const long = 'x'.repeat(60_000);
    const { html } = await renderMdx('```ts\n' + long + '\n```');
    // 语言类被摘掉 → Prism 跳过，改由 data-language 记录
    expect(html).toContain('data-code-plain="true"');
    expect(html).toContain('data-language="ts"');
    expect(html).not.toContain('class="token');
    // 内容一个字不少
    expect(html).toContain(long.slice(0, 200));
  });
});

/**
 * 花括号前缀标记 `=={.variant} 正文 ==`
 *
 * 2026-09-12 用户报障：点击网络层讲义时 /render 500，
 * 日志 `Could not parse expression with acorn`。
 *
 * 根因：mark 语法原本只支持「后缀」`==正文=={.variant}` 与「冒号前缀」
 * `==variant:正文==`，**花括号前缀从未被支持** —— `{.tip}` 的花括号落进
 * MDX 表达式解析，且故障形态随该行是否含行内代码分叉：
 * - 该行不含行内代码 → escapeBareBraces 兜底转义 → 不崩，但变体名丢失、
 *   正文显出字面 `{.tip}`（静默降级，与崩溃同样属于缺陷）；
 * - 该行含行内代码 → normalizeMathFences 因 `t.includes('`')` 整行跳过 →
 *   花括号完全裸露 → acorn 崩 → 整篇 evaluate 失败。
 *
 * 修复：新增 encodeMarkLeadVariant，排在 normalizeSource 第 2 层
 * （必须早于 normalizeMathFences —— 后者的 escapeBareBraces 一旦把 `{`
 * 转义为 `\{`，前缀形态就再也认不出来）。
 */
describe('花括号前缀标记（=={.variant} 正文 ==）', () => {
  /** 取第一个 mark 元素的内部文本 */
  const markText = (html: string): string | undefined =>
    /<mark[^>]*>([\s\S]*?)<\/mark>/.exec(html)?.[1];

  it('前缀 `.tip` 正确识别变体（修复前静默降级为 primary + 字面 `{.tip}`）', async () => {
    const { html } = await renderMdx('=={.tip} 这是重点 ==');
    expect(html).toContain('mark-tip');
    expect(html).not.toContain('{.tip}');
    expect(markText(html)).toBe('这是重点 ');
  });

  it('前缀 `.error` 正确识别变体', async () => {
    const { html } = await renderMdx('=={.error} 这是错误 ==');
    expect(html).toContain('mark-error');
  });

  it('含行内代码的前缀不再崩 acorn（本次事故最小复现）', async () => {
    const { html } = await renderMdx('=={.tip} 这是重点 `code` ==');
    expect(html).toContain('mark-tip');
    expect(html).toContain('<code>code</code>');
  });

  it('事故原行（第四章网络层，含行内代码 + 行内公式）', async () => {
    const src =
      '> =={.tip} 反推技巧：由子网掩码的点分十进制形式，可直接数出前缀长度。例如 `255.255.255.192` → $192 = 11000000_2$ → 前缀 /26。==';
    const { html } = await renderMdx(src);
    expect(html).toContain('mark-tip');
    expect(html).toContain('<code>255.255.255.192</code>');
    expect(html).not.toContain('katex-error');
  });

  it('后缀形态不被误伤（尾部 `=={.x}` 是闭合定界符，不是开标记）', async () => {
    const { html } = await renderMdx('==这是重点=={.tip}');
    expect(html).toContain('mark-tip');
    // 内容必须完整；若尾部被误当初开标记，会残留字面 `==` 且 mark 消失
    expect(markText(html)).toBe('这是重点');
    expect(html).not.toContain('==');
  });

  it('引用块内的前缀形态', async () => {
    const { html } = await renderMdx('> =={.error} 三个单位是失分点 ==');
    expect(html).toContain('mark-error');
  });

  it('列表项内的前缀形态（`warning` 是 `error` 的语义别名）', async () => {
    const { html } = await renderMdx('- =={.warning} 编号冲突 ==');
    expect(html).toContain('mark-error');
  });

  it('白名单外的变体名原样保留为字面（不静默吞用户内容）', async () => {
    const { html } = await renderMdx('=={.nope} 这是重点 ==');
    expect(html).toContain('{.nope}');
    expect(html).not.toContain('mark-tip');
  });

  it('行内代码里的示例写法不被改写', async () => {
    const { html } = await renderMdx('写法是 `=={.tip} x ==`');
    expect(html).toContain('=={.tip} x ==');
    expect(html).not.toContain('mark-tip');
  });

  it('encodeMarkLeadVariant 直接单测：白名单命中编码、未命中原样、幂等', () => {
    expect(encodeMarkLeadVariant('=={.tip} x ==')).toBe('=={.tip} x =='.replace('=={.tip} ', '\uE000=\uE000=tip\uE000'));
    expect(encodeMarkLeadVariant('=={.nope} x ==')).toBe('=={.nope} x ==');
    const once = encodeMarkLeadVariant('=={.tip} x ==');
    expect(encodeMarkLeadVariant(once)).toBe(once);
  });
});

/**
 * 含行内代码的行：**代码区外**的裸 `<` / `{` 仍需安全化
 *
 * 2026-09-12 与上一组同源（同一函数、同一事故）：normalizeMathFences 原先对
 * 「含反引号的行」整行透传，本意是保护行内代码里的字面 `$$`。副作用是
 * 代码区**外**的裸 `<` / `{` 一并失去防护，例如「见 `code` 说明，误差 <0.5」
 * 同样崩 acorn。修复：按行内代码边界分段，代码区原样、其余照常安全化。
 */
describe('含行内代码行的安全化（代码区隔离）', () => {
  it('代码区外的裸 `<` 被安全化（原先整行跳过 → acorn 崩）', async () => {
    const { html } = await renderMdx('见 `code` 说明，误差 <0.5 舍去');
    expect(html).toContain('&lt;0.5');
    expect(html).toContain('<code>code</code>');
  });

  it('代码区外的裸 `{2a}` 被安全化', async () => {
    const { html } = await renderMdx('见 `code` 记作 {2a}');
    expect(html).toContain('{2a}');
  });

  it('代码区内的危险字符原样保留（不能被转义成 `\\<`）', async () => {
    const { html } = await renderMdx('参照 `<0.5` 与 `{2a}` 的写法');
    expect(html).toContain('<code>&lt;0.5</code>');
    expect(html).toContain('<code>{2a}</code>');
    expect(html).not.toContain('\\<');
  });

  it('display 数学块内含反引号的行：公式花括号仍保留（跨行状态不被绕过）', async () => {
    const src = '$$\n\\begin{aligned}\na_{1} &= b_{1}\\\\\n\\end{aligned}\n$$';
    const { html } = await renderMdx(src);
    const tex = [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)]
      .map((m) => m[1])
      .join('\n');
    expect(tex).toContain('a_{1}');
    expect(tex).not.toContain('\\{');
  });
});

/**
 * 跨行 display 数学（`$$` 拆行后公式内容勿被当成普通文本转义花括号）
 *
 * 2026-09-12 用户报障：文档文章界面里 n 阶行列式显示为红字源码。
 * 根因是 normalizeMathFences 把 `$$ … $$` 拆成多行后，公式**中间的行既无 `$`
 * 也无 `$$`**，而 escapeBareBraces 只在单行内靠 `$` 计数判断数学区 → 把
 * `a_{11}` 转义成 `a_\{11\}`、`\end{vmatrix}` 转义成 `\end\{vmatrix\}`，
 * KaTeX 抛 `Mismatch: \begin{vmatrix} matched by \end{\{}`。
 * 修复：normalizeMathFences 跨行跟踪 display 数学状态（inDisplayMath）。
 */
describe('跨行 display 数学（全块花括号保留）', () => {
  /** 抽取所有 KaTeX 的 TeX 源码（annotation 里的原文） */
  async function texOf(src: string): Promise<string> {
    const { html } = await renderMdx(src);
    expect(html).not.toContain('katex-error');
    return [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)]
      .map((m) => m[1])
      .join('\n');
  }

  const VMATRIX = [
    '$$D_n = \\begin{vmatrix}',
    'a_{11} & a_{12} & \\cdots & a_{1n} \\\\',
    'a_{21} & a_{22} & \\cdots & a_{2n} \\\\',
    '\\vdots & \\vdots & \\ddots & \\vdots \\\\',
    'a_{n1} & a_{n2} & \\cdots & a_{nn}',
    '\\end{vmatrix}$$',
  ].join('\n');

  it('顶层多行 `vmatrix`：花括号原样、KaTeX 无错误、渲染出矩阵表', async () => {
    const { html } = await renderMdx(VMATRIX);
    expect(html).not.toContain('katex-error');
    // MathML 层出现表格结构 = 真的按矩阵排出来了
    expect(html).toContain('<mtable');
    const tex = await texOf(VMATRIX);
    expect(tex).toContain('\\begin{vmatrix}');
    expect(tex).toContain('\\end{vmatrix}');
    expect(tex).toContain('a_{11}');
    // 不得出现被转义的花括号
    expect(tex).not.toContain('\\{');
    expect(tex).not.toContain('\\end\\{vmatrix\\}');
  });

  it('callout 容器内多行 display 数学同样正确（用户实际场景）', async () => {
    const doc = [
      ':::callout[定义 1.1（$n$ 阶行列式）]{type=info}',
      '将 $n^2$ 个数排成一个 $n$ 行 $n$ 列的表格：',
      '',
      VMATRIX,
      '',
      '简记作 $D_n = \\det(a_{ij})$。',
      ':::',
    ].join('\n');
    const { html } = await renderMdx(doc);
    expect(html).not.toContain('katex-error');
    expect(html).toContain('<mtable');
    const tex = await texOf(doc);
    expect(tex).toContain('\\end{vmatrix}');
    expect(tex).not.toContain('\\{');
    // 容器标题与正文的行内数学也不受影响
    expect(tex).toContain('\\det(a_{ij})');
  });

  it('引用块内多行 display 数学：不会因拆行而转义花括号', async () => {
    const src = ['> $$', '> \\frac{n}{2}', '> $$'].join('\n');
    const tex = await texOf(src);
    expect(tex).toContain('\\frac{n}{2}');
    expect(tex).not.toContain('\\frac\\{');
  });

  it('数学块结束后，正文的裸花括号仍照常转义（acorn 防护不回退）', async () => {
    const src = ['$$', '\\frac{n}{2}', '$$', '', '正文 {2a} 与 {.tip}'].join('\n');
    const { html } = await renderMdx(src);
    expect(html).not.toContain('katex-error');
    // 文本层原样显示（说明已被安全化为字面量，而不是喂给 acorn）
    expect(html).toContain('{2a}');
    expect(html).toContain('{.tip}');
  });

  it('单行 `$$…$$` 的花括号同样保留', async () => {
    const tex = await texOf('$$D_n = \\det(a_{ij})$$');
    expect(tex).toContain('\\det(a_{ij})');
    expect(tex).not.toContain('\\{');
  });

  it('公式内容里的裸 `{` 不再触发 acorn（跨行状态不破坏 MDX 解析）', async () => {
    // 含 `\{` 之前的裸 `{x}` 在数学区内交给 KaTeX；此处确认整篇不 500
    const src = ['$$', 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', '$$'].join('\n');
    const { html } = await renderMdx(src);
    expect(html).not.toContain('katex-error');
    expect(html).toContain('<mtable');
  });
});


describe('渲染缓存（normalizeSource / invalidateRenderCache）', () => {
  it('normalizeSource 稳定：同输入必得同输出', () => {
    const src = ':::tabs#pkg\n\n@tab npm\n\n正文 ==高亮=={.tip}\n\n:::\n\n$$\\frac{n}{2}$$\n';
    expect(normalizeSource(src)).toBe(normalizeSource(src));
  });

  it('缓存命中返回同一对象引用', async () => {
    const src = '## 缓存一致性\n\n> $$t = 1 + \\frac{n}{2}$$\n\n==重点=={.tip}\n';
    clearRenderCache();
    const first = await renderMdx(src);
    const second = await renderMdx(src);
    expect(second).toBe(first);
  });

  it('invalidateRenderCache 传入原始源码即可清除条目', async () => {
    // 这条用例锁死 P2-24：失效必须用与写入**相同**的归一化结果算 key。
    // 早期版本用 djb2(raw source) 删、djb2(normalized) 写，两侧永不相等 → 失效是 no-op。
    const src = '## 待失效\n\n正文 {A} 与 ==高亮==\n';
    clearRenderCache();
    const first = await renderMdx(src);
    const cached = await renderMdx(src);
    expect(cached).toBe(first);

    invalidateRenderCache(src);
    const after = await renderMdx(src);
    // 失效后重新渲染，应得到全新对象（而非缓存里的那个）
    expect(after).not.toBe(first);
    expect(after.html).toEqual(first.html);
  });

  it('自定义 components 不写入缓存（每次都重渲染）', async () => {
    const src = '## 自定义组件\n\n正文\n';
    const a = await renderMdx(src, { components: {} });
    const b = await renderMdx(src, { components: {} });
    expect(b).not.toBe(a);
  });

  it('哈希不碰撞：djb2 会撞的两个短串在 SHA-1 下渲染结果互不影响', async () => {
    // ' A' 与 '! ' 在 32 位 djb2（含长度后缀）下会碰撞；换 SHA-1 后不再撞
    const a = await renderMdx(' A');
    const b = await renderMdx('! ');
    expect(a.html).not.toEqual(b.html);
  });
});
