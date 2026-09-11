/**
 * Tabs：`:::tabs#id` 容器 → <Tabs>
 *
 * 从 mdx-plugins.ts 拆出（P1-9 大文件拆分）：原文近 1600 行，四大语法块与公共插件
 * 挤在一个文件里，改一处要在千行上下文里定位。本模块只保留该语法自身的
 * 常量 / 拆分函数 / remark 插件；公共节点助手见 ./nodes。
 */
import type { Node, Paragraph, Root, RootContent } from 'mdast';
import { jsxAttr, jsxFlow, patched, type MdxDirectiveNode, type MdxJsxFlowNode } from './nodes';

/** 便捷别名：容器插件里统一按 DirectiveNode 书写 */
type DirectiveNode = MdxDirectiveNode;

/* ============================================================================
 * 选项卡组：`:::tabs#id` + `@tab` 分区 → <Tabs>（对齐 VuePress Plume 主题）
 *
 * ## 源语法
 *
 *   :::tabs#package-manager
 *
 *   @tab npm
 *
 *   使用 npm 安装。
 *
 *   @tab:active **pnpm**#pnpm
 *
 *   使用 pnpm 安装。
 *
 *   :::
 *
 * - `#package-manager` 是**稳定标识值**：同页多个选项卡组只要标识相同，
 *   选中状态即互相同步（不改变标签的可见标题）；
 * - `@tab:active` 指定该项初始激活（同组多个只取第一个）；
 * - `@tab` 后的标签支持行内 Markdown（`**加粗**` / `` `代码` `` 等）；
 * - 标签尾部的 `#锚点` 是该项的稳定 ID（用于跨组联动对齐），从可见标题中剥离。
 *
 * ## 解析前置
 *
 * 源语法含三重 remark-directive 冲突（`#` 容器名、`@tab` 非标准、`:` 被吃成
 * textDirective），且 remark-directive **不支持嵌套容器**。因此源码层的
 * `normalizeTabs`（src/lib/mdx.ts）已把语法改写为「容器 + 一个无序列表」：
 * 每个 `@tab` 变成列表项 `- <哨兵>active<分隔>标签`，正文缩进为该项续行。
 * 本插件因此只需处理与 `remarkCollapse` 同构的形态。
 * ==========================================================================*/

/** 选项卡组标记哨兵（与 mdx.ts 的 TABS_MARK_SENTINEL 对应） */
const TABS_MARK_SENT = '\uE003';
/** 选项卡组标签行的字段分隔符（与 mdx.ts 的 TABS_FIELD_SEP 对应） */
const TABS_FIELD_SEP_LOCAL = '\uE004';

/**
 * 从选项卡列表项中拆出「标签节点」「激活态」「锚点」与「正文节点」。
 *
 * 源码层已把 `@tab[:active] 标签[#锚点]` 编码为列表项首行
 * `<哨兵>active<分隔>标签[#锚点]`，因此这里在首个文本节点里解出元信息。
 */
function splitTabsItem(item: Node): {
  labelNodes: Node[];
  active: boolean;
  anchor: string;
  bodyNodes: Node[];
} {
  const children = ((item as DirectiveNode).children ?? []) as Node[];
  const first = children[0];
  if (!first || first.type !== 'paragraph') {
    return { labelNodes: [], active: false, anchor: '', bodyNodes: children };
  }

  const paraChildren = ((first as Paragraph).children ?? []) as Node[];
  const labelNodes: Node[] = [];
  let active = false;
  let anchor = '';

  // 首个文本节点形如 `<S>active<分隔>锚点<分隔>标签原文(起始段)`
  // ⚠️ 标签原文可能含行内 Markdown，被 micromark 拆到后续节点（甚至 strong/em 内部）；
  //    因此这里**只吃掉前缀**（哨兵 + active 标记 + 锚点 + 紧随的分隔符），
  //    余下文本与所有后续兄弟节点原样保留为标签内容。
  let consumed = false;
  for (const child of paraChildren) {
    const c = child as Node & { value?: string };
    if (!consumed && c.type === 'text' && typeof c.value === 'string') {
      const idx = c.value.indexOf(TABS_MARK_SENT);
      if (idx !== -1) {
        const sep1 = c.value.indexOf(TABS_FIELD_SEP_LOCAL, idx);
        if (sep1 !== -1) {
          const flag = c.value.slice(idx + TABS_MARK_SENT.length, sep1);
          active = flag === 'active';
          const sep2 = c.value.indexOf(TABS_FIELD_SEP_LOCAL, sep1 + TABS_FIELD_SEP_LOCAL.length);
          if (sep2 !== -1) {
            anchor = c.value.slice(sep1 + TABS_FIELD_SEP_LOCAL.length, sep2);
            const labelHead = c.value.slice(sep2 + TABS_FIELD_SEP_LOCAL.length);
            if (labelHead !== '') labelNodes.push(patched(c, { value: labelHead }));
          } else {
            // 异常形态：只有一层分隔 → 分隔符后全当标签
            const labelHead = c.value.slice(sep1 + TABS_FIELD_SEP_LOCAL.length);
            if (labelHead !== '') labelNodes.push(patched(c, { value: labelHead }));
          }
          consumed = true;
          continue;
        }
      }
      // 首个文本节点没有哨兵 → 非本语法产出，原样保留
      consumed = true;
    }
    labelNodes.push(child);
  }

  const bodyNodes = children.slice(1);
  return { labelNodes, active, anchor, bodyNodes };
}

/**
 * remark 插件：把 `:::tabs` 容器转换为 `<Tabs>` JSX 节点。
 *
 * 每个分区产出为一个 `<Tab>` 子节点；标签（含富文本）作为
 * `data-tab-label` 标记段落置于首位，供组件抽进选项卡按钮。
 *
 * 非法形态（容器内没有无序列表 / 分区为空）→ **原样保留**，不吞用户内容。
 */
export function remarkTabs() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type !== 'containerDirective' || node.name !== 'tabs') {
          if (Array.isArray(node.children)) walk(node.children);
          continue;
        }

        const attrs = (node.attributes ?? {}) as Record<string, string>;
        // 稳定标识值来自源码层改写出的 `{#id}` 简写
        // （remark-directive 不支持 `key="value"` 属性语法，详见 normalizeTabs 注释）
        const stableId = attrs.id ?? '';

        const inner = (node.children ?? []) as Node[];
        const lists = inner.filter((c) => c.type === 'list');
        const isOrdered = lists.some((l) => (l as unknown as { ordered?: boolean }).ordered === true);
        if (lists.length !== 1 || isOrdered) {
          walk(inner);
          continue;
        }

        const list = lists[0] as DirectiveNode;
        const items = ((list.children ?? []) as Node[]).filter((c) => c.type === 'listItem');
        if (items.length < 2) {
          // 少于 2 个分区：降级为普通 Markdown（源码层已判过一次，双保险）
          walk(inner);
          continue;
        }

        let activeAssigned = false;
        const tabs: Node[] = items.map((item, idx) => {
          const { labelNodes, active, anchor, bodyNodes } = splitTabsItem(item);
          // 初始激活：同组只认第一个 `:active`，其余回落到索引 0
          const isActive = active && !activeAssigned;
          if (isActive) activeAssigned = true;

          const tabChildren: Node[] = [];
          if (labelNodes.length > 0) {
            tabChildren.push(jsxFlow('p', [jsxAttr('data-tab-label', 'true')], labelNodes));
          }
          // ⚠️ 必须先递归处理正文再 push（walk 就地替换，见 remarkCallout 说明）
          walk(bodyNodes);
          tabChildren.push(...bodyNodes);

          return jsxFlow(
            'Tab',
            [
              jsxAttr('active', isActive ? 'true' : 'false'),
              ...(anchor ? [jsxAttr('anchor', anchor)] : []),
            ],
            tabChildren,
          );
        });

        // 二次兜底：确保恰好有一项 active
        const anyActive = tabs.some((t) => {
          const a = (t as unknown as MdxJsxFlowNode).attributes;
          return a?.some((x) => x.name === 'active' && x.value === 'true');
        });
        if (!anyActive && tabs.length > 0) {
          const a = (tabs[0] as unknown as MdxJsxFlowNode).attributes;
          const attr = a.find((x) => x.name === 'active');
          if (attr) attr.value = 'true';
        }

        children[i] = {
          type: 'mdxJsxFlowElement',
          name: 'Tabs',
          attributes: stableId ? [{ type: 'mdxJsxAttribute', name: 'stableId', value: stableId }] : [],
          children: tabs,
        } as unknown as RootContent;
      }
    };
    walk(tree.children);
  };
}

