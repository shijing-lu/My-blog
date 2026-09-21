/**
 * Spoiler（黑幕）：`:spoiler[内容]` 行内指令 → <Spoiler>
 *
 * ## 语法（remark-directive 行内 textDirective）
 *
 *   最终的答案是 :spoiler[42]。
 *   黑幕内部支持 :spoiler[`行内代码` 以及包含 **加强调** 的较长详情]。
 *
 * label 内容由 remark-directive 自动解析为行内 mdast 节点（strong/code/…），
 * 因此黑幕内部天然支持完整行内 Markdown。
 *
 * ## 行为（与页面开关联动，见 src/scripts/spoiler.ts）
 *
 * - 文章页默认「完整显示」：`html[data-spoiler-hide]` 不存在或为 off 时，
 *   `<Spoiler>` 内的正文原样可见，不隐藏；
 * - 开启「隐藏模式」后：遮罩生效，悬停 / 聚焦 / 点击（aria-expanded）揭示；
 * - 无 JS 环境下 CSS :hover / :focus 揭示仍然可用（渐进增强）。
 *
 * ## 为什么走 mdxJsxTextElement（与 remarkDirectiveToJsx 的 Admonition 行内分支同构）
 *
 * `:note` 行内指令已走「textDirective → mdxJsxTextElement('Admonition')」路径且
 * 生产稳定。⚠️ mdx-plugins.ts 的 mark 语法注释记录过「程序化构造行内 JSX」的
 * 序列化坑（当时失败的是 mark 哨兵形态），本插件的构造方式与 Admonition 分支
 * 完全一致（name + attributes + directive 原生 children），并有单测覆盖嵌套
 * strong / inlineCode 场景（tests/mdx.test.ts）。
 */
import type { Node, Root, RootContent } from 'mdast';
import { type MdxDirectiveNode } from './nodes';

/** 便捷别名：与 collapse/callout 插件一致 */
type DirectiveNode = MdxDirectiveNode;

/**
 * remark 插件：把 `:spoiler[...]` 行内指令转换为 `<Spoiler>` JSX 文本元素。
 *
 * - 仅处理 `textDirective` 且 `name === 'spoiler'`（块级 `:::spoiler` 不属于本语法，
 *   留给现有指令链路，行为不变）；
 * - **无 label**（`:spoiler` 后无方括号内容）时不转换：空黑幕没有意义，
 *   交给现有链路按未识别指令处理（与既往行为一致，不新增渲染分支）；
 * - 递归先处理 label 内部（嵌套 `:spoiler[...]` 支持到任意深度），再替换外层节点；
 * - 其余节点原样下钻，保证 callout / collapse / tabs 等容器内部的 spoiler
 *   同样被处理（本插件注册在 remarkDirective 之后、容器插件之前，
 *   容器插件转换时会把已生成的 Spoiler JSX 节点随 children 原样携带）。
 */
export function remarkSpoiler() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type === 'textDirective' && node.name === 'spoiler') {
          const inner = (node.children ?? []) as Node[];
          if (inner.length === 0) {
            // 无 label：降级为未识别指令（不产出空黑幕）
            continue;
          }
          walk(inner);
          children[i] = {
            type: 'mdxJsxTextElement',
            name: 'Spoiler',
            attributes: [],
            children: inner,
          } as unknown as RootContent;
          continue;
        }
        if (Array.isArray(node.children)) walk(node.children);
      }
    };
    walk(tree.children);
  };
}
