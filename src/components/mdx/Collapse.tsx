/**
 * Collapse / CollapsePanel 组件 —— `:::collapse` 折叠面板的渲染目标
 *
 * 语法（由 remarkCollapse 解析，见 src/lib/mdx-plugins.ts）:
 *   :::collapse                   默认全部折叠
 *   :::collapse expand            整组默认展开
 *   :::collapse accordion         整组互斥（手风琴）
 *   :::collapse accordion expand  互斥 + 默认展开
 *
 *   - 面板标题          普通面板
 *   - :+ 默认展开       该项初始展开
 *   - :- 强制折叠       整组 expand 时把该项压回折叠
 *
 *   （标题后空一行，再写正文，正文支持完整块级 Markdown）
 *
 * ## 实现要点
 *
 * - 折叠用**原生 `<details>/<summary>`**：浏览器原生行为在 ClientRouter
 *   转场后自动生效，无需任何 JS 重绑（与 Callout 同一决策）。
 * - 手风琴互斥用 **HTML `name` 属性**（同一 `name` 的 details 互斥），
 *   同样零 JS。旧浏览器不支持时降级为「可同时展开」，功能不坏。
 * - `name` 必须**每次渲染唯一**，否则同页多组手风琴会互相干扰 →
 *   按组生成 `collapse-<n>`（n 为组件实例序号，SSR 稳定）。
 * - 标题段落由 remarkCollapse 打 `data-collapse-head` 标记并置于首位，
 *   组件抽出放进 `<summary>`，从而支持加粗 / 行内代码 / 公式等富文本。
 */
import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react';

interface CollapseProps {
  /** 手风琴模式（互斥） */
  accordion?: string | boolean;
  children?: ReactNode;
}

interface CollapsePanelProps {
  /** 初始展开状态 */
  open?: string | boolean;
  /** 由 Collapse 注入的互斥组名（accordion 模式非空） */
  groupName?: string;
  children?: ReactNode;
}

/** 把 prop 收窄为布尔（MDX 传进来的是字符串 "true"） */
function toBool(v: string | boolean | undefined): boolean {
  return v === true || v === 'true';
}

/**
 * 判断节点是否为「标题行段落」。
 * remarkCollapse 给富标题段落注入 `data-collapse-head="true"`。
 */
function isHeadParagraph(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { 'data-collapse-head'?: string } | null;
  return props?.['data-collapse-head'] === 'true';
}

/** 取出标题行段落的内容（去掉包裹标签，只保留内联节点） */
function extractHeadContent(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return null;
  const props = node.props as { children?: ReactNode } | null;
  return props?.children ?? null;
}

/**
 * 单个折叠面板。
 *
 * 由 `<Collapse>` 遍历子节点后克隆注入 `groupName`，因此本组件通常不直接使用。
 */
export function CollapsePanel({ open, groupName, children }: CollapsePanelProps): ReactNode {
  const list = Children.toArray(children);
  let headingSlot: ReactNode = null;
  let bodyChildren: ReactNode[] = list;
  if (list.length > 0 && isHeadParagraph(list[0])) {
    headingSlot = extractHeadContent(list[0]);
    bodyChildren = list.slice(1);
  }

  return (
    <details
      className="md-collapse-panel"
      open={toBool(open)}
      name={groupName || undefined}
    >
      <summary className="md-collapse-panel-title">
        <span className="md-collapse-panel-text">{headingSlot}</span>
        <span className="md-collapse-panel-chevron" aria-hidden="true" />
      </summary>
      <div className="md-collapse-panel-body">{bodyChildren}</div>
    </details>
  );
}

/**
 * 折叠面板组容器。
 *
 * 遍历 panels：accordion 模式下给每个 panel 注入同一个 `groupName`
 * （用 `useId` 保证跨组唯一，避免多组手风琴互相抢占）。
 */
export default function Collapse({ accordion, children }: CollapseProps): ReactNode {
  const isAccordion = toBool(accordion);
  const reactId = useId();
  // useId 产物形如 «r0» / :r0:，含特殊字符不宜直接做 name 值，做一次净化
  const groupName = isAccordion ? `collapse-group-${reactId.replace(/[^a-zA-Z0-9-]/g, '')}` : '';

  return (
    <div className="md-collapse" data-collapse-accordion={isAccordion ? 'true' : undefined}>
      {Children.map(children, (child) => {
        if (!isAccordion) return child;
        if (!isValidElement(child)) return child;
        // 只给本语法产出的面板注入组名，避免误改用户嵌进来的其他组件
        if (child.type !== CollapsePanel) return child;
        return cloneElement(child as React.ReactElement<CollapsePanelProps>, { groupName });
      })}
    </div>
  );
}
