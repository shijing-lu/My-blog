/**
 * MDX 渲染管线单元测试
 */
import { describe, expect, it } from 'vitest';
import { renderMdx, renderMarkdownHtml } from '../src/lib/mdx';
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
