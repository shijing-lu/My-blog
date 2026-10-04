/**
 * 动效实验室 · 交错调节器
 * ---------------------------------------------------------------------------
 * 核心问题：交错间隔是"元素数量"的函数，不是常量。
 * 30 项若按 0.055 逐项入场，总时长 1.6 秒 —— 用户会明确觉得"卡"。
 *
 * 这一节让「数量 / 基础间隔 / 实际上限」三者的关系可见：
 * 拖动滑块时能同时看到 interval 被压缩、总时长被压在 0.62s 以内。
 * 这条规则写在 staggerInterval() 里，是全站共用的。
 */

import { m } from "motion/react";
import { useCallback, useMemo, useState } from "react";

import { listContainer, listItem } from "../variants/collections";
import { stagger } from "../tokens";
import { staggerInterval, staggerTotal } from "../utils";
import { useAdaptiveMotion, useResolvedVariants } from "../hooks";

const COUNTS = [3, 6, 12, 20, 30, 60];

export function StaggerTuner() {
  const adaptive = useAdaptiveMotion();
  const [count, setCount] = useState(12);
  const [base, setBase] = useState<number>(stagger.base);
  const [key, setKey] = useState(0);

  const interval = useMemo(() => staggerInterval(count, base), [count, base]);
  const total = useMemo(() => staggerTotal(count, base), [count, base]);
  const capped = interval < base;

  const containerVariants = useResolvedVariants(listContainer(interval));
  const itemVariants = useResolvedVariants(listItem);

  const replay = useCallback(() => setKey((k) => k + 1), []);

  return (
    <div className="space-y-5">
      <section className="surface-card p-5">
        <h3 className="text-[15px]">参数</h3>
        <p className="text-ink-3 mt-1.5 text-[12px] leading-relaxed">
          交错总时长被硬性压在 <span className="numeric">{stagger.max}s</span>{" "}
          以内。 元素一多，间隔会自动被压缩 —— 所以"30 项列表的入场"不会变成 1.6
          秒的等待。
        </p>

        <div className="mt-4 space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-ink-2 text-[12.5px]">元素数量</span>
              <span className="numeric text-ink-1 text-[13px] font-medium">
                {count}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setCount(n);
                    replay();
                  }}
                  aria-pressed={n === count}
                  className={[
                    "craft-transition-fast numeric rounded-[var(--radius-hand-pill)] px-3 py-1 text-[12px]",
                    n === count
                      ? "text-paper-base bg-amber-deep"
                      : "hand-frame text-ink-3 hover:text-ink-1",
                  ].join(" ")}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-ink-2 text-[12.5px]">基础间隔</span>
              <span className="numeric text-ink-1 text-[13px] font-medium">
                {base.toFixed(3)}s
              </span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.12}
              step={0.005}
              value={base}
              aria-label="基础间隔"
              onChange={(event) => {
                setBase(Number(event.target.value));
                replay();
              }}
              className="w-full accent-[var(--color-amber-base)]"
            />
            <div className="text-ink-4 numeric mt-1 flex justify-between text-[10.5px]">
              <span>0.01 紧凑</span>
              <span>tight {stagger.tight}</span>
              <span>base {stagger.base}</span>
              <span>loose {stagger.loose}</span>
              <span>0.12 松散</span>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[15px]">实时结果</h3>
          <button
            type="button"
            onClick={replay}
            className="hand-frame craft-transition-fast text-ink-3 hover:text-ink-1 shrink-0 rounded-[var(--radius-hand-pill)] px-3 py-1 text-[11.5px]"
          >
            重放
          </button>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="surface-inset p-3">
            <dt className="text-ink-3 text-[11px]">实际间隔</dt>
            <dd className="numeric text-ink-1 font-serif text-[19px] leading-tight">
              {interval.toFixed(4)}s
            </dd>
            {capped ? (
              <p className="text-clay-deep mt-0.5 text-[10.5px]">
                已被上限压缩
              </p>
            ) : (
              <p className="text-forest-deep mt-0.5 text-[10.5px]">
                未触发上限
              </p>
            )}
          </div>
          <div className="surface-inset p-3">
            <dt className="text-ink-3 text-[11px]">总时长</dt>
            <dd className="numeric text-ink-1 font-serif text-[19px] leading-tight">
              {total.toFixed(3)}s
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">
              上限 {stagger.max}s
            </p>
          </div>
          <div className="surface-inset p-3">
            <dt className="text-ink-3 text-[11px]">自适应上限</dt>
            <dd className="numeric text-ink-1 font-serif text-[19px] leading-tight">
              {adaptive.maxStagger}
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">
              {adaptive.disableLayoutChoreography ? "低端设备" : "常规设备"}
            </p>
          </div>
          <div className="surface-inset p-3">
            <dt className="text-ink-3 text-[11px]">是否启用交错</dt>
            <dd className="numeric text-ink-1 font-serif text-[19px] leading-tight">
              {count > 12 ? "否" : "是"}
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">&gt;12 项自动关闭</p>
          </div>
        </dl>

        <div
          key={key}
          className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-10"
        >
          <m.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="contents"
          >
            {Array.from({ length: count }, (_, i) => (
              <m.div
                key={i}
                variants={itemVariants}
                className="surface-inset grid h-10 place-items-center rounded-[var(--radius-hand-sm)]"
              >
                <span className="numeric text-ink-4 text-[10px]">{i + 1}</span>
              </m.div>
            ))}
          </m.div>
        </div>
      </section>
    </div>
  );
}
