/**
 * 模块占位（M0 阶段的脚手架）
 *
 * M0 只交付骨架，各功能模块按 M3–M7 依次实现。
 * 占位块把"这个模块负责什么、在哪个里程碑实现、依赖哪个文档章节"讲清楚，
 * 避免后续接手时靠猜。
 */

import { HandRule } from "@/cadence/shared/motion";

interface ModulePlaceholderProps {
  title: string;
  milestone: string;
  /** 该模块要解决的问题 */
  summary: string;
  /** 计划实现的关键能力 */
  items: readonly string[];
  /** 对应的需求编号，如 FR-REV-01 */
  refs?: readonly string[];
}

export function ModulePlaceholder({
  title,
  milestone,
  summary,
  items,
  refs,
}: ModulePlaceholderProps) {
  return (
    <section className="surface-card p-7">
      <div className="flex flex-wrap items-baseline gap-3">
        {/* 用 h3 而非 h2：页面标题已是 h2（h1 是品牌名），
         * 区块再用 h2 会破坏标题层级，也会让 getByRole('heading', {level:2, name:'计划'})
         * 这类选择器同时命中「计划」与「计划的制定与拆解」。 */}
        <h3 className="text-lg">{title}</h3>
        <span className="rounded-[var(--radius-hand-sm)] bg-amber-soft px-2.5 py-1 text-xs text-amber-deep">
          {milestone}
        </span>
      </div>

      <HandRule shape="wave" tone="mark" className="my-4" />

      <p className="text-ink-2 max-w-3xl text-sm">{summary}</p>

      <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item}
            className="surface-inset flex gap-2.5 p-3 text-[13px] text-ink-2"
          >
            <span aria-hidden="true" className="text-amber-base select-none">
              ✦
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {refs && refs.length > 0 ? (
        <p className="text-ink-3 mt-5 text-xs">
          对应需求：
          {refs.map((ref) => (
            <code key={ref} className="numeric text-ink-2 ml-1">
              {ref}
            </code>
          ))}
        </p>
      ) : null}
    </section>
  );
}
