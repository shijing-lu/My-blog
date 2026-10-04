/**
 * 动效实验室 · 令牌层
 * ---------------------------------------------------------------------------
 * 目的：把"时长 / 缓动 / 弹簧"这些抽象数字变成**可并排对比的视觉**。
 *
 * 为什么必须有这一页：调动画时最大的问题是"改完不知道变好了还是变差了"。
 * 只看代码里的 0.32 / 0.16,0.84 是没法判断的，必须并排跑一遍。
 *
 * 全部动画只作用 transform，符合红线 R1。
 */

import { m } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { distance, duration, ease, spring } from "../tokens";
import { useResolvedMotion } from "../hooks";
import type { Transition } from "motion/react";

/** 探针小球直径与右端留白；用常量而非运行时测量，避免与 CSS 不同步 */
const BALL = 14;
const TRACK_GAP = 8;

/** 区块外壳：标题 + 说明 + 一次性重放全部探针 */
function LabSection({
  title,
  description,
  onReplay,
  children,
}: {
  title: string;
  description: ReactNode;
  onReplay?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="surface-card p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-[15px]">{title}</h3>
        {onReplay ? (
          <button
            type="button"
            onClick={onReplay}
            className="hand-frame craft-transition-fast text-ink-3 hover:text-ink-1 shrink-0 rounded-[var(--radius-hand-pill)] px-3 py-1 text-[11.5px]"
          >
            全部重放
          </button>
        ) : null}
      </div>
      <p className="text-ink-3 mt-1.5 mb-4 text-[12px] leading-relaxed">
        {description}
      </p>
      {children}
    </section>
  );
}

/**
 * 动效探针：小球从左滑到右
 *
 * 位移距离必须**实测轨道宽度**：
 *   Motion 的 x 支持数字或百分比，但百分比是"相对元素自身尺寸"，
 *   对 14px 的小球来说 x: '100%' 只有 14px，完全跑不出效果。
 *   早期版本用过 `calc(100% + 100px)`，既不可控也无法随容器自适应。
 */
function Probe({
  label,
  value,
  transition,
  replayKey,
}: {
  label: string;
  value: string;
  transition: Transition;
  replayKey: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(0);
  const resolved = useResolvedMotion(transition);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () =>
      setTravel(Math.max(0, track.clientWidth - BALL - TRACK_GAP));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="surface-inset flex items-center gap-3 px-3 py-2.5">
      <div className="w-[112px] shrink-0">
        <p className="text-ink-1 text-[12.5px] font-medium">{label}</p>
        <p className="text-ink-4 numeric text-[10.5px]">{value}</p>
      </div>

      <div
        ref={trackRef}
        className="bg-paper-1/60 relative h-6 flex-1 overflow-hidden rounded-full"
      >
        <m.span
          key={replayKey}
          aria-hidden="true"
          className="bg-amber-base absolute top-1/2 left-1 block h-3.5 w-3.5 -translate-y-1/2 rounded-full"
          initial={{ x: 0 }}
          animate={{ x: travel }}
          transition={resolved}
        />
      </div>
    </div>
  );
}

export function TokenSection() {
  const [key, setKey] = useState(0);
  const replay = useCallback(() => setKey((k) => k + 1), []);

  return (
    <div className="space-y-5">
      <LabSection
        title="时长 Duration"
        onReplay={replay}
        description={
          <>
            分档是语义，不是随手取的数字。操作动效（instant /
            fast）用于高频点击， 环境动效（base / slow /
            deliberate）用于值得被看见的状态跃迁。
            下面全部使用相同缓动，只有时长不同 —— 这样差异才归因清晰。
          </>
        }
      >
        <div className="space-y-2">
          {Object.entries(duration).map(([name, value]) => (
            <Probe
              key={name}
              label={name}
              value={`${value}s · ${Math.round(value * 1000)}ms`}
              transition={{ duration: value, ease: ease.standard }}
              replayKey={key}
            />
          ))}
        </div>
      </LabSection>

      <LabSection
        title="缓动 Easing"
        onReplay={replay}
        description={
          <>
            统一用 base 时长，只有曲线不同。<b>出现</b>用
            decelerate（快进慢落位）、
            <b>消失</b>用 accelerate（慢启动快离场）、<b>原地变化</b>用
            standard、
            <b>成功反馈</b>才用 overshoot。overshoot 全站不超过 3
            处，用多了会显得廉价。
          </>
        }
      >
        <div className="space-y-2">
          {Object.entries(ease).map(([name, value]) => (
            <Probe
              key={name}
              label={name}
              value={value.map((n) => n.toFixed(2)).join(", ")}
              transition={{ duration: duration.base, ease: value }}
              replayKey={key}
            />
          ))}
        </div>
      </LabSection>

      <LabSection
        title="弹簧 Spring"
        onReplay={replay}
        description={
          <>
            物理属性一律用弹簧而非固定时长 —— 可中断、可续接。注意回弹幅度：
            手作风格刻意让 smooth / gentle 比通用 UI
            多一点回弹，"放上去"才有手工感； bouncy 只给低频的成功时刻，settle
            专用于拖拽落位（不能过度弹跳）。
          </>
        }
      >
        <div className="space-y-2">
          {Object.entries(spring).map(([name, value]) => (
            <Probe
              key={name}
              label={name}
              value={`k${value.stiffness} / d${value.damping} / m${value.mass}`}
              transition={value}
              replayKey={key}
            />
          ))}
        </div>
      </LabSection>

      <LabSection
        title="位移与缩放"
        description={
          <>
            手作风格的入场距离比通用 UI 略大（md = {distance.md}px），
            因为"摆上去"需要看得见过程；而起始缩放更接近 1，
            因为过小的起点会让元素显得是"缩出来"的，而不是"放上去"的。
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="surface-inset p-4">
            <p className="text-ink-3 mb-3 text-[11.5px]">distance · 位移档位</p>
            <div className="flex items-end gap-4">
              {Object.entries(distance).map(([name, value]) => (
                <div key={name} className="text-center">
                  <div
                    aria-hidden="true"
                    className="bg-amber-base mx-auto mb-1 w-1.5 rounded-full"
                    style={{ height: value * 1.6 }}
                  />
                  <p className="text-ink-4 numeric text-[10.5px]">{name}</p>
                  <p className="text-ink-3 numeric text-[10.5px]">{value}px</p>
                </div>
              ))}
            </div>
          </div>

          <div className="surface-inset p-4">
            <p className="text-ink-3 mb-3 text-[11.5px]">
              scaleFrom · 起始缩放
            </p>
            <div className="flex items-end gap-4">
              {(
                [
                  ["subtle", 0.98],
                  ["card", 0.96],
                  ["panel", 0.92],
                  ["pop", 0.85],
                ] as const
              ).map(([name, value]) => (
                <div key={name} className="text-center">
                  <div
                    aria-hidden="true"
                    className="bg-amber-soft shadow-[inset_0_0_0_1.5px_var(--color-amber-base)] mx-auto mb-1 rounded-[var(--radius-hand-sm)]"
                    style={{
                      width: 44,
                      height: 44,
                      transform: `scale(${value})`,
                    }}
                  />
                  <p className="text-ink-4 numeric text-[10.5px]">{name}</p>
                  <p className="text-ink-3 numeric text-[10.5px]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </LabSection>
    </div>
  );
}
