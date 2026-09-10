/**
 * Tabs / Tab 组件 —— `:::tabs#id` 选项卡组的渲染目标（**仅负责 SSR 结构**）
 *
 * 语法（由 remarkTabs 解析，见 src/lib/mdx-plugins.ts）:
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
 * - `@tab:active` 指定该项初始激活；
 * - `@tab` 后的标签支持行内 Markdown（`**加粗**` / `` `代码` ``）；
 * - 标签尾部的 `#锚点` 是该项的稳定 ID，用于跨组联动对齐（从可见标题剥离）。
 *
 * ## 为什么组件不含交互逻辑
 *
 * 正文由 `renderMdx` 用 `renderToString` **直出 HTML**，MDX 区块不参与客户端
 * 水合（每个区块是独立渲染树，无法用 Context 跨组联动）。因此这里的职责
 * 只是产出正确的、语义化的、可访问的骨架：
 *
 * - `role="tablist"` / `role="tab"` / `role="tabpanel"` 语义完整；
 * - 初始选中态（`aria-selected` / `tabindex` / `hidden`）在此定稿，
 *   **未启用 JS 时依然可用**（只是无法切换）；
 * - 稳定标识与锚点落到 `data-*` 属性，供脚本读取。
 *
 * 切换、跨组联动、键盘导航、横向滚动均由 `src/scripts/tabs.ts` 以
 * document 级事件委托渐进增强（View Transitions 转场后自动生效）。
 *
 * 视觉完全复用博客既有设计体系（见 global.css 的 `.md-tabs*` 段）。
 */
import { Children, isValidElement, useMemo, type ReactNode } from 'react';

interface TabsProps {
  /** 稳定标识值（同值跨组联动） */
  stableId?: string;
  children?: ReactNode;
}

interface TabProps {
  /** 是否初始激活 */
  active?: string | boolean;
  /** 该项的稳定标识（跨组联动对齐用；为空时按序号对齐） */
  anchor?: string;
  children?: ReactNode;
}

/** 把 prop 收窄为布尔（MDX 传进来的是字符串 "true"） */
function toBool(v: string | boolean | undefined): boolean {
  return v === true || v === 'true';
}

/** 判断节点是否为「标签行段落」（remarkTabs 注入 `data-tab-label="true"`） */
function isLabelParagraph(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { 'data-tab-label'?: string } | null;
  return props?.['data-tab-label'] === 'true';
}

/** 取出标签行段落的内容（保留内联富文本节点） */
function extractLabelContent(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return null;
  const props = node.props as { children?: ReactNode } | null;
  return props?.children ?? null;
}

/** 从单个 Tab 元素中拆出「标签节点」与「正文节点」 */
function splitTabElement(child: ReactNode): { label: ReactNode; body: ReactNode[] } {
  if (!isValidElement(child)) return { label: null, body: [] };
  const props = child.props as { children?: ReactNode } | null;
  const list = Children.toArray(props?.children);
  if (list.length > 0 && isLabelParagraph(list[0])) {
    return { label: extractLabelContent(list[0]), body: list.slice(1) };
  }
  return { label: null, body: list };
}

/**
 * 单个选项卡面板。
 *
 * 说明：实际 DOM 由 `<Tabs>` 组织（它读取本组件的 props 后统一渲染导航与面板）；
 * 本组件保留导出是为了让 remarkTabs 产出的 `<Tab>` 节点能在组件注册表中解析。
 * 直接使用时会退化为「标签 + 正文」的普通块（不应发生）。
 */
export function Tab({ children }: TabProps): ReactNode {
  const list = Children.toArray(children);
  const body = list.length > 0 && isLabelParagraph(list[0]) ? list.slice(1) : list;
  return <div className="md-tabs-panel">{body}</div>;
}

/**
 * 选项卡组容器（SSR 骨架）。
 *
 * 读取子 `Tab` 的 `active` / `anchor` 元信息，裁定初始激活项，
 * 渲染「导航栏（仅按钮） + 面板区（仅内容）」两段结构。
 */
export default function Tabs({ stableId = '', children }: TabsProps): ReactNode {
  const list = useMemo(() => Children.toArray(children), [children]);

  const items = useMemo(
    () =>
      list.map((child) => {
        const p = isValidElement(child)
          ? (child.props as { anchor?: string; active?: string | boolean } | null)
          : null;
        const { label, body } = splitTabElement(child);
        return {
          anchor: p?.anchor ?? '',
          active: toBool(p?.active),
          label,
          body,
        };
      }),
    [list],
  );

  const initialIndex = useMemo(() => {
    const i = items.findIndex((it) => it.active);
    return i === -1 ? 0 : i;
  }, [items]);

  return (
    <div className="md-tabs" data-tabs-stable-id={stableId || undefined}>
      <div className="md-tabs-nav" role="tablist">
        {items.map((it, index) => {
          const selected = index === initialIndex;
          return (
            <button
              key={index}
              type="button"
              role="tab"
              className="md-tabs-tab"
              data-tab-anchor={it.anchor || undefined}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
            >
              <span className="md-tabs-tab-text">{it.label}</span>
            </button>
          );
        })}
      </div>
      {items.map((it, index) => (
        <div
          key={index}
          role="tabpanel"
          className="md-tabs-panel"
          hidden={index !== initialIndex}
          data-tab-panel-anchor={it.anchor || undefined}
        >
          {it.body}
        </div>
      ))}
    </div>
  );
}

/** 导出类型供测试/类型推导使用 */
export type { TabsProps, TabProps };
