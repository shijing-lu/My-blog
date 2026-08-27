/**
 * 番茄钟全局状态（跨页面后台运行）
 *
 * 设计：
 * - 状态存 localStorage（key: studyTimer），任何页面都能读写；
 * - BaseLayout 注入的全局 tick 每秒检查状态：running 时倒计时，
 *   到点自动响铃/通知/记录（登录时 POST /api/study/sessions）并切换模式；
 * - /study 页面只负责"发起/操作"与 UI 渲染，读同一状态；
 * - 因此切到首页/导航/影集/日历/动态后，计时仍在后台继续。
 */

export interface StudyTimerCfg {
  focus: number; // 分钟
  short: number; // 分钟
  long: number; // 分钟
  every: number; // 每几个番茄长休息
}

export type StudyMode = 'focus' | 'short' | 'long';

export interface StudyTimerState {
  mode: StudyMode;
  running: boolean;
  /** 结束时间戳（running 时有效） */
  endTime: number;
  /** 暂停时保留的剩余秒数（非 running 时有效） */
  pausedRemaining: number;
  /** 本轮已完成番茄数 */
  roundCount: number;
  /** 当前任务 id（可空） */
  taskId: string | null;
  cfg: StudyTimerCfg;
}

export const STUDY_TIMER_KEY = 'studyTimer';

const DEFAULT_CFG: StudyTimerCfg = { focus: 25, short: 5, long: 15, every: 4 };

/** 读取全局状态（无/损坏则返回 null） */
export function readTimerState(): StudyTimerState | null {
  try {
    const raw = localStorage.getItem(STUDY_TIMER_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StudyTimerState>;
    if (!s || typeof s.mode !== 'string' || !s.cfg) return null;
    const cfg: StudyTimerCfg = {
      focus: Number(s.cfg.focus) || DEFAULT_CFG.focus,
      short: Number(s.cfg.short) || DEFAULT_CFG.short,
      long: Number(s.cfg.long) || DEFAULT_CFG.long,
      every: Number(s.cfg.every) || DEFAULT_CFG.every,
    };
    return {
      mode: (s.mode === 'short' || s.mode === 'long' ? s.mode : 'focus') as StudyMode,
      running: Boolean(s.running),
      endTime: Number(s.endTime) || 0,
      pausedRemaining: Math.max(0, Number(s.pausedRemaining) || 0),
      roundCount: Math.max(0, Number(s.roundCount) || 0),
      taskId: typeof s.taskId === 'string' ? s.taskId : null,
      cfg,
    };
  } catch {
    return null;
  }
}

/** 写入全局状态 */
export function writeTimerState(state: StudyTimerState): void {
  try {
    localStorage.setItem(STUDY_TIMER_KEY, JSON.stringify(state));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 某模式时长（秒） */
export function durationSecFor(mode: StudyMode, cfg: StudyTimerCfg): number {
  return (mode === 'focus' ? cfg.focus : mode === 'short' ? cfg.short : cfg.long) * 60;
}

/** 新建一个默认状态（focus，未运行） */
export function freshTimerState(cfg?: StudyTimerCfg): StudyTimerState {
  const c = cfg ?? DEFAULT_CFG;
  return {
    mode: 'focus',
    running: false,
    endTime: 0,
    pausedRemaining: durationSecFor('focus', c),
    roundCount: 0,
    taskId: null,
    cfg: { ...c },
  };
}

/** 剩余秒数（running 时基于 endTime 计算防漂移；暂停时用 pausedRemaining） */
export function remainingSec(state: StudyTimerState, now = Date.now()): number {
  if (state.running) return Math.max(0, Math.ceil((state.endTime - now) / 1000));
  return Math.max(0, state.pausedRemaining || durationSecFor(state.mode, state.cfg));
}

/** 是否登录（cookie 会话由服务端渲染 data-authed 注入；此处用隐藏标记） */
export function isTimerAuthed(): boolean {
  const el = document.querySelector<HTMLElement>('[data-authed]');
  return el?.dataset.authed === '1';
}

/** 记录完成的番茄（登录时；失败静默） */
export async function reportSession(taskId: string | null, durationSec: number): Promise<void> {
  try {
    await fetch('/api/study/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, durationSec }),
    });
  } catch {
    /* 静默 */
  }
}

/** 蜂鸣（Web Audio，需用户交互后可用；失败静默） */
export function beep(): void {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.start();
    o.stop(ctx.currentTime + 0.8);
    o.onended = () => void ctx.close();
  } catch {
    /* 无声兜底 */
  }
}

/** 浏览器通知（权限已授予时） */
export function notify(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    /* 忽略 */
  }
}

/**
 * 处理"当前阶段到点"：切换模式、响铃/通知、记录番茄（登录时）、写回状态。
 * @returns 新状态
 */
export async function advanceTimer(state: StudyTimerState): Promise<StudyTimerState> {
  const wasFocus = state.mode === 'focus';
  const next: StudyTimerState = { ...state, running: false, endTime: 0, pausedRemaining: 0 };
  if (wasFocus) {
    // 记录完成的番茄（仅完整完成；全局 tick 只在到点时调用）
    if (isTimerAuthed()) {
      await reportSession(state.taskId, durationSecFor('focus', state.cfg));
    }
    next.roundCount += 1;
    beep();
    notify('🍅 番茄完成！', `专注 ${state.cfg.focus} 分钟，休息一下吧`);
    next.mode = next.roundCount % state.cfg.every === 0 ? 'long' : 'short';
  } else {
    beep();
    notify('☕ 休息结束', '开始下一个番茄吧');
    next.mode = 'focus';
  }
  next.pausedRemaining = durationSecFor(next.mode, next.cfg);
  writeTimerState(next);
  // 完成事件（供 /study 刷新统计等）
  window.dispatchEvent(new CustomEvent('study-timer-done', { detail: next }));
  return next;
}

/** 通知其他页面/组件：计时状态已变化（自定义事件，供 /study 同步 UI） */
export function emitTimerChange(state: StudyTimerState | null): void {
  window.dispatchEvent(new CustomEvent('study-timer-change', { detail: state }));
}
