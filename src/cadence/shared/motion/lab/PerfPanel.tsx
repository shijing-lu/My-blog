/**
 * 动效实验室 · 性能面板
 * ---------------------------------------------------------------------------
 * 定位：把"这里到底卡不卡"变成可读数字的**观测工具**。
 *
 * 两条重要区分（避免误用）：
 *   1. 运行时降级走 useAdaptiveMotion 的**静态硬件判断**（可预测、可复现），
 *      不看这里的实时帧率。用实时帧率决定降级会导致行为不可复现。
 *   2. 帧率数字本身要谨慎解读：无头环境 / 后台标签页的 rAF 会被节流，
 *      显示 5fps 是浏览器在省电，不是代码慢。所以面板上同时显示
 *      "是否可见"与长任务计数 —— 长任务才是代码问题的可靠信号。
 */

import { AnimatedNumber } from "../components/AnimatedNumber";
import { useCallback, useState } from "react";

import {
  MOTION_OPTIONS,
  TEXTURE_OPTIONS,
} from "@/cadence/shared/config/appearance";
import { useAppearanceStore } from "@/cadence/shared/store/appearance-store";
import { useAdaptiveMotion, useFpsMeter } from "../hooks";
import { stagger } from "../tokens";

function Metric({
  label,
  value,
  suffix,
  tone = "normal",
  hint,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "normal" | "good" | "bad";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-forest-deep"
      : tone === "bad"
        ? "text-clay-deep"
        : "text-ink-1";

  return (
    <div className="surface-inset p-3">
      <p className="text-ink-3 text-[11px]">{label}</p>
      <p
        className={["font-serif text-[19px] leading-tight", toneClass].join(
          " ",
        )}
      >
        <AnimatedNumber value={value} suffix={suffix} />
      </p>
      {hint ? <p className="text-ink-4 mt-0.5 text-[10.5px]">{hint}</p> : null}
    </div>
  );
}

export function PerfPanel() {
  const [active, setActive] = useState(true);
  const stats = useFpsMeter(active);
  const adaptive = useAdaptiveMotion();

  const motion = useAppearanceStore((s) => s.motion);
  const texture = useAppearanceStore((s) => s.texture);
  const theme = useAppearanceStore((s) => s.theme);
  const setMotion = useAppearanceStore((s) => s.setMotion);
  const setTexture = useAppearanceStore((s) => s.setTexture);
  const setTheme = useAppearanceStore((s) => s.setTheme);

  const reset = useCallback(() => stats.reset(), [stats]);

  return (
    <div className="space-y-5">
      <section className="surface-card p-5">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[15px]">帧率与长任务</h3>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setActive((v) => !v)}
              className="hand-frame craft-transition-fast text-ink-3 hover:text-ink-1 rounded-[var(--radius-hand-pill)] px-3 py-1 text-[11.5px]"
            >
              {active ? "暂停采样" : "开始采样"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="hand-frame craft-transition-fast text-ink-3 hover:text-ink-1 rounded-[var(--radius-hand-pill)] px-3 py-1 text-[11.5px]"
            >
              清零
            </button>
          </div>
        </div>

        <p className="text-ink-3 mt-1.5 text-[12px] leading-relaxed">
          验收标准（04 号文档 §1.1）：动画帧率 ≥ 60fps、长任务（&gt;50ms）占比
          &lt; 2%。 若出现长任务，通常是 JS 阻塞而非动画本身的问题 —— 动画只动
          transform / opacity， 正常情况不会产生长任务。
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-5">
          <Metric
            label="当前帧率"
            value={stats.fps}
            suffix="fps"
            tone={stats.fps >= 55 ? "good" : stats.fps > 0 ? "bad" : "normal"}
            hint="目标 ≥ 60"
          />
          <Metric
            label="最低帧率"
            value={stats.minFps}
            suffix="fps"
            hint="本次观测区间"
          />
          <Metric
            label="长任务"
            value={stats.longTasks}
            tone={stats.longTasks > 0 ? "bad" : "good"}
            hint="> 50ms 的任务"
          />
          <Metric
            label="最长任务"
            value={stats.worstLongTask}
            suffix="ms"
            tone={stats.worstLongTask > 50 ? "bad" : "good"}
          />
          <Metric label="掉帧" value={stats.droppedFrames} hint="单帧 > 20ms" />
        </dl>

        <p className="text-ink-4 mt-3 text-[11px] leading-relaxed">
          注意：标签页切到后台或窗口被遮挡时，浏览器会把 rAF 节流到 1fps 左右。
          此时帧率低是省电行为，不是性能问题 ——
          面板的采样会在页面不可见时失去参考价值，
          请在**页面处于前台**时读取数字。
        </p>
      </section>

      <section className="surface-card p-5">
        <h3 className="text-[15px]">一键切换三档（实时验证降级路径）</h3>
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px] leading-relaxed">
          切换后全站立即生效。重点验证两件事：
          <b>关闭档下所有状态切换仍然正确完成</b>（红线 R5：降级为 duration
          0，而不是不渲染）， 以及<b>质感关闭档下纹理资源根本不加载</b>（红线
          C8：display none 而非 opacity 0）。
        </p>

        {(
          [
            ["动效强度", motion, MOTION_OPTIONS, setMotion],
            ["质感强度", texture, TEXTURE_OPTIONS, setTexture],
          ] as const
        ).map(([label, value, options, setter]) => (
          <div key={label} className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-ink-2 w-20 text-[12.5px]">{label}</span>
            <div
              role="group"
              aria-label={label}
              className="surface-inset inline-flex gap-1 p-1"
              style={{ borderRadius: "var(--radius-hand-pill)" }}
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === value}
                  onClick={() => setter(option.value)}
                  title={option.hint}
                  className={[
                    "craft-transition-fast rounded-[var(--radius-hand-pill)] px-3.5 py-1.5 text-[12.5px]",
                    option.value === value
                      ? "bg-paper-1 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-paper-line)]"
                      : "text-ink-3 hover:text-ink-1",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ink-2 w-20 text-[12.5px]">主题</span>
          <div
            role="group"
            aria-label="主题"
            className="surface-inset inline-flex gap-1 p-1"
            style={{ borderRadius: "var(--radius-hand-pill)" }}
          >
            {(["light", "dark"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
                className={[
                  "craft-transition-fast rounded-[var(--radius-hand-pill)] px-3.5 py-1.5 text-[12.5px]",
                  theme === value
                    ? "bg-paper-1 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-paper-line)]"
                    : "text-ink-3 hover:text-ink-1",
                ].join(" ")}
              >
                {value === "light" ? "纸面" : "墨夜"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="surface-card p-5">
        <h3 className="text-[15px]">自适应降级配置（运行时实际值）</h3>
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px] leading-relaxed">
          依据 <span className="numeric">navigator.hardwareConcurrency</span> 与
          <span className="numeric"> deviceMemory</span> 的**静态判断**，
          不是实时帧率 —— 后者会让行为不可复现、无法写出稳定的验收用例。
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {(
            [
              [
                "布局让位编排",
                adaptive.disableLayoutChoreography ? "已关闭" : "启用",
              ],
              ["交错间隔上限", String(adaptive.maxStagger)],
              ["滚动联动", adaptive.disableScrollLinked ? "已关闭" : "启用"],
              ["阴影层级", `${adaptive.elevationLevels} 档`],
              ["同时运动元素上限", String(adaptive.maxConcurrent)],
              ["交错总时长上限", `${stagger.max}s`],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="surface-inset flex items-baseline justify-between px-3 py-2.5"
            >
              <dt className="text-ink-3 text-[12px]">{label}</dt>
              <dd className="numeric text-ink-1 text-[12.5px] font-medium">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
