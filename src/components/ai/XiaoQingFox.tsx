/**
 * XiaoQingFox —— 小狐狸形象（内联 SVG，五态切换，主题自适应）
 *
 * 状态映射：meta.level / familiarity → 眼睛、尾巴、装饰的变化。
 * 本组件是纯展示组件（无状态、无副作用），按 props 渲染。
 */
import type { ReactNode } from 'react';

/** 表情状态 */
export type FoxMood = 'idle' | 'happy' | 'surprised' | 'sleepy';

/** 形象 Props */
interface FoxProps {
  /** 尺寸（px，默认 36） */
  size?: number;
  /** 等级（0~7，影响装饰） */
  level?: number;
  /** 表情（默认 idle） */
  mood?: FoxMood;
}

/** 眼睛渲染（按表情切换） */
function eyes(mood: FoxMood, cx: number, cy: number): ReactNode {
  const lx = cx - 8;
  const rx = cx + 8;
  if (mood === 'happy') {
    return (
      <>
        <path d={`M${lx - 4} ${cy} Q ${lx} ${cy - 5} ${lx + 4} ${cy}`} fill="none" stroke="#2C2C2A" strokeWidth="2.2" strokeLinecap="round" />
        <path d={`M${rx - 4} ${cy} Q ${rx} ${cy - 5} ${rx + 4} ${cy}`} fill="none" stroke="#2C2C2A" strokeWidth="2.2" strokeLinecap="round" />
      </>
    );
  }
  if (mood === 'surprised') {
    return (
      <>
        <circle cx={lx} cy={cy} r="5.5" fill="#FFFFFF" stroke="#2C2C2A" strokeWidth="1.3" />
        <circle cx={lx} cy={cy} r="2.3" fill="#2C2C2A" />
        <circle cx={rx} cy={cy} r="5.5" fill="#FFFFFF" stroke="#2C2C2A" strokeWidth="1.3" />
        <circle cx={rx} cy={cy} r="2.3" fill="#2C2C2A" />
      </>
    );
  }
  if (mood === 'sleepy') {
    return (
      <>
        <path d={`M${lx - 4} ${cy} h8`} stroke="#2C2C2A" strokeWidth="2" strokeLinecap="round" />
        <path d={`M${rx - 4} ${cy} h8`} stroke="#2C2C2A" strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  // idle / 默认：圆眼
  return (
    <>
      <circle cx={lx} cy={cy} r="4" fill="#2C2C2A" />
      <circle cx={lx - 1.2} cy={cy - 1.2} r="1.3" fill="#FFFFFF" />
      <circle cx={rx} cy={cy} r="4" fill="#2C2C2A" />
      <circle cx={rx - 1.2} cy={cy - 1.2} r="1.3" fill="#FFFFFF" />
    </>
  );
}

/** 小狐狸 SVG（单只，居中于 0,0 附近） */
function foxSvg(size: number, level: number, mood: FoxMood): ReactNode {
  const s = size / 72; // 缩放因子（基准 72px）
  const golden = '#EF9F27';
  const brown = '#8A5A2B';
  const orange = '#E8863A';
  const cream = '#FAEEDA';
  const blush = '#F0997B';

  return (
    <g transform={`scale(${s}) translate(36, 44)`}>
      {/* 尾巴（在身体后面） */}
      <path
        d="M18 24 q22 6 18 -18"
        fill="none"
        stroke={orange}
        strokeWidth="12"
        strokeLinecap="round"
        opacity={mood === 'sleepy' ? 0.4 : 1}
      />
      <circle cx={35} cy={6} r="6" fill={cream} />

      {/* 身体 */}
      <ellipse cx={0} cy={22} rx={17} ry={13} fill={orange} />

      {/* 耳朵 */}
      <path d="M-18 -18 L-22 -38 L-6 -26 Z" fill={orange} />
      <path d="M18 -18 L22 -38 L6 -26 Z" fill={orange} />
      <path d="M-17 -21 L-19 -33 L-10 -25 Z" fill={blush} />
      <path d="M17 -21 L19 -33 L10 -25 Z" fill={blush} />

      {/* 头 */}
      <circle cx={0} cy={-6} r={22} fill={orange} />
      {/* 口鼻 */}
      <ellipse cx={0} cy={2} rx={10} ry={7} fill={cream} />
      <ellipse cx={0} cy={-2} rx={3} ry={2.2} fill="#2C2C2A" />
      {/* 腮红 */}
      <ellipse cx={-14} cy={4} rx={5.5} ry={3.5} fill={blush} />
      <ellipse cx={14} cy={4} rx={5.5} ry={3.5} fill={blush} />
      {/* 眼睛 */}
      {eyes(mood, 0, -10)}

      {/* 等级装饰 */}
      {level >= 3 && (
        <ellipse cx={0} cy={-38} rx={20} ry={5} fill="none" stroke={golden} strokeWidth="2.5" />
      )}
      {level >= 5 && (
        <>
          <circle cx={-18} cy={-38} r={2.5} fill={golden} />
          <circle cx={0} cy={-44} r={3} fill={golden} />
          <circle cx={18} cy={-38} r={2.5} fill={golden} />
        </>
      )}
      {level >= 7 && (
        <path
          d="M-28 -2 q-10 24 -2 34 q30 -12 60 0 q8 -10 -2 -34"
          fill="#E24B4A"
          stroke="#A32D2D"
          strokeWidth="1.5"
        />
      )}
    </g>
  );
}

/** 小狐狸形象组件 */
export default function XiaoQingFox({ size = 36, level = 0, mood = 'idle' }: FoxProps): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="小狐狸"
      style={{ display: 'block' }}
    >
      {foxSvg(size, level, mood)}
    </svg>
  );
}
