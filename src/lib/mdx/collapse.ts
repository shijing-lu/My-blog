/**
 * Collapse：`:::collapse` 容器 → <Collapse>
 *
 * 从 mdx-plugins.ts 拆出（P1-9 大文件拆分）：原文近 1600 行，四大语法块与公共插件
 * 挤在一个文件里，改一处要在千行上下文里定位。本模块只保留该语法自身的
 * 常量 / 拆分函数 / remark 插件；公共节点助手见 ./nodes。
 */
import type { Node, Paragraph, Root, RootContent } from 'mdast';
import { jsxAttr, jsxFlow, patched, type MdxDirectiveNode } from './nodes';

/** 便捷别名：容器插件里统一按 DirectiveNode 书写 */
type DirectiveNode = MdxDirectiveNode;

/* ============================================================================
 * 折叠面板：`:::collapse` 容器 + 无序列表 → <Collapse>
 *
 * ## 语法（对齐 VuePress Plume 主题的 collapse 容器）
 *
 *   :::collapse [accordion] [expand]
 *   - 面板标题
 *
 *     面板正文（完整块级 Markdown）
 *
 *   - :+ 默认展开的面板标题
 *
 *     正文……
 *   :::
 *
 * ## 规则
 *
 * - 容器内**有且仅有一个顶层无序列表**；每个列表项 = 一个面板；
 * - 列表项内：**首行到首个空行为标题**，首个空行之后为正文（完整块级 Markdown）；
 * - `:+` / `:-` 前缀标记该项初始「展开 / 折叠」，写在标题之前（`- :+ 标题`）；
 * - `accordion` 整组互斥（用 HTML `<details name>` 原生实现，零 JS）；
 * - `expand` 整组默认展开；此时 `:-` 可把单项压回折叠；
 * - 默认（无参数）：全部折叠，仅 `:+` 标记项展开。
 *
 * ## 参数来源
 *
 * remark-directive 只认花括号属性，源码层的 `normalizeCollapseParams`
 * （src/lib/mdx.ts）已把空格写法 `:::collapse accordion` 改写为
 * `:::collapse{accordion}`，因此这里直接读 `attributes`。
 *
 * ## 与列表项解析的配合
 *
 * 列表项的 `spread`（松散列表）会让「标题行」与「正文」被拆成多个段落。
 * 这里不依赖 spread，而是**按 children 顺序**取：第一个 paragraph 的首行
 * 做标题，其残余内容 + 后续所有块做正文 —— 与 Plume 语义一致且更健壮。
 * ==========================================================================*/

/** `:::collapse` 已识别的参数（由源码层保证只出现白名单词） */
const COLLAPSE_PARAM_NAMES_LOCAL = new Set(['accordion', 'expand']);

/** 标题行前的初始状态标记：源码层已把 `:+` / `:-` 编码为哨兵 + 符号 */
const COLLAPSE_MARK_SENT = '\uE002';

/**
 * 从标题节点数组中剥离并返回初始状态标记（`+` 展开 / `-` 折叠）。
 *
 * 源码层 `encodeCollapseMarkers` 已把 `:+` 变为 `<哨兵>+`，因此这里
 * 在**首个文本节点**里找 `<哨兵><符号>`。找不到返回空串（跟随组默认值）。
 *
 * ⚠️ 不能在源码层保留裸 `:` —— remark-directive 会把它吃成 textDirective，
 * 既匹配不到文本，还会渲染出空 `<div>`。
 */
function takeCollapseMarker(nodes: Node[]): string {
  for (const node of nodes) {
    const n = node as Node & { value?: string };
    if (n.type !== 'text' || typeof n.value !== 'string') continue;
    const idx = n.value.indexOf(COLLAPSE_MARK_SENT);
    if (idx === -1) {
      // 标记必定在最前面的文本节点；首个文本节点没有就说明该项无标记
      return '';
    }
    const sign = n.value.charAt(idx + COLLAPSE_MARK_SENT.length);
    const marker = sign === '+' || sign === '-' ? sign : '';
    // 一并吃掉哨兵、符号与紧随其后的空白
    const before = n.value.slice(0, idx);
    const after = n.value.slice(idx + COLLAPSE_MARK_SENT.length + 1).replace(/^[ \t]+/, '');
    n.value = before + after;
    return marker;
  }
  return '';
}

/**
 * 从列表项中拆出「标题节点」与「正文节点」。
 *
 * 取法：
 * 1. 首个 paragraph 的第一行（遇到 `\n` 为止）为标题原文；
 * 2. 该 paragraph 剩余的兄弟节点（`\n` 之后的富文本）留在正文首段；
 * 3. 其余 children 全部归正文。
 *
 * @returns `{ headNodes, marker, bodyNodes }`；无标题（首子不是段落）时 headNodes 为空
 */
function splitCollapseItem(item: Node): { headNodes: Node[]; marker: string; bodyNodes: Node[] } {
  const children = ((item as DirectiveNode).children ?? []) as Node[];
  const first = children[0];
  if (!first || first.type !== 'paragraph') {
    return { headNodes: [], marker: '', bodyNodes: children };
  }

  const para = first as Paragraph;
  const paraChildren = (para.children ?? []) as Node[];
  const headNodes: Node[] = [];
  const restNodes: Node[] = [];
  let sawBreak = false;

  for (const child of paraChildren) {
    const c = child as Node & { value?: string };
    if (!sawBreak && c.type === 'text' && typeof c.value === 'string' && c.value.includes('\n')) {
      // 首个含换行的文本节点：换行前为标题，换行后归正文
      const [headPart, ...restParts] = c.value.split('\n');
      const restText = restParts.join('\n');
      if (headPart !== '') headNodes.push(patched(c, { value: headPart }));
      if (restText !== '') restNodes.push(patched(c, { value: restText }));
      sawBreak = true;
      continue;
    }
    if (!sawBreak) headNodes.push(child);
    else restNodes.push(child);
  }

  // 首段没有换行 → 整段都是标题（项内无正文）
  const bodyNodes: Node[] = [];
  if (restNodes.length > 0) {
    bodyNodes.push(patched(first, { children: restNodes }));
  }
  bodyNodes.push(...children.slice(1));

  // 剥离并记录 `:+` / `:-` 标记（哨兵形态，只看标题节点）
  const marker = takeCollapseMarker(headNodes);

  return { headNodes, marker, bodyNodes };
}

/**
 * remark 插件：把 `:::collapse` 容器转换为 `<Collapse>` JSX 节点。
 *
 * 每个面板产出为一个 `<CollapsePanel>` 子节点；标题（含富文本）作为
 * `data-collapse-head` 标记段落置于首位，供组件抽进 `<summary>`。
 *
 * 非法形态（容器内没有无序列表 / 列表项为空）→ **原样保留**容器内容，
 * 不静默吞掉用户内容。
 */
export function remarkCollapse() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type !== 'containerDirective' || node.name !== 'collapse') {
          if (Array.isArray(node.children)) walk(node.children);
          continue;
        }

        // 参数：源码层已把空格写法归一为花括号属性
        const attrs = (node.attributes ?? {}) as Record<string, string>;
        const accordion = Object.keys(attrs).some(
          (k) => COLLAPSE_PARAM_NAMES_LOCAL.has(k.toLowerCase()) && k.toLowerCase() === 'accordion',
        );
        const expandAll = Object.keys(attrs).some((k) => k.toLowerCase() === 'expand');

        // 容器内必须是「恰好一个顶层无序列表」（允许列表前后有空白段落）
        const inner = (node.children ?? []) as Node[];
        const lists = inner.filter((c) => c.type === 'list');
        const isOrdered = lists.some((l) => (l as unknown as { ordered?: boolean }).ordered === true);
        if (lists.length !== 1 || isOrdered) {
          walk(inner);
          continue;
        }

        const list = lists[0] as DirectiveNode;
        const items = ((list.children ?? []) as Node[]).filter((c) => c.type === 'listItem');
        if (items.length === 0) {
          walk(inner);
          continue;
        }

        const panels: Node[] = items.map((item) => {
          const { headNodes, marker, bodyNodes } = splitCollapseItem(item);
          // 展开态优先级：单项 `:-` > 单项 `:+` > 整组 expand > 默认折叠
          let open = expandAll;
          if (marker === '+') open = true;
          if (marker === '-') open = false;

          const panelChildren: Node[] = [];
          if (headNodes.length > 0) {
            panelChildren.push(jsxFlow('p', [jsxAttr('data-collapse-head', 'true')], headNodes));
          }
          // ⚠️ 必须先递归处理正文再 push（walk 是就地替换，见 remarkCallout 同款说明）
          walk(bodyNodes);
          panelChildren.push(...bodyNodes);

          return jsxFlow('CollapsePanel', [jsxAttr('open', open ? 'true' : 'false')], panelChildren);
        });

        children[i] = jsxFlow(
          'Collapse',
          accordion ? [jsxAttr('accordion', 'true')] : [],
          panels,
        ) as unknown as RootContent;
      }
    };
    walk(tree.children);
  };
}

