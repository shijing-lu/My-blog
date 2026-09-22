/**
 * AI 小卿：养成度（bond）纯函数与 DB 读写
 *
 * 设计：
 * - 纯函数区可单测（等级派生 / 亲密度 / 分量归一化），DB 区只做读写；
 * - **等级只升不降**：断签不清零，避免养成变成打卡压力；
 * - 权重：对话深度 0.45 > 消息数 0.25 > 活跃天数 0.20 > 连续天数 0.10（用户指定）。
 *
 * ## 分量归一化口径
 * - 深度：`depthScore` 千分制整数累加（每次消息按 √长度×2 打分，上限 50/条），对数压缩防刷量；
 * - 消息数：`log10(1+count) / log10(1+1000)`，1000 条时归一化到 1；
 * - 活跃天数：`days / 90` 截断到 1（90 天归满）；
 * - 连续天数：`streak / 30` 截断到 1（30 天归满），断签清零但**不清等级**。
 */
import { eq } from 'drizzle-orm';
import { db, dbWrite } from '../../db';
import { aiBond } from '../../db/schema.sqlite';
import { deriveLevel } from './ai-bond-levels';

// 等级表（纯常量/纯函数）拆在客户端安全的模块里——客户端组件（AiChatFloat/
// XiaoQingFox）必须从这里引用，绝不能让 DB 代码被打进浏览器 bundle
export {
  LEVEL_THRESHOLDS,
  LEVEL_BEHAVIOR,
  LEVEL_NAMES,
  deriveLevel,
  levelBehaviorText,
} from './ai-bond-levels';

/* ============================================================================
 * 养成聚合行（ai_bond 表的行形态）
 * ==========================================================================*/

export interface BondRow {
  id: string;
  messageCount: number;
  activeDays: number;
  streakDays: number;
  maxStreak: number;
  depthScore: number;
  bondPoints: number;
  level: number;
  nickname: string;
  lastActiveDate: string;
  updatedAt: Date;
}

/** 默认行（首次交互时创建） */
export function defaultBondRow(): BondRow {
  return {
    id: 'owner',
    messageCount: 0,
    activeDays: 0,
    streakDays: 0,
    maxStreak: 0,
    depthScore: 0,
    bondPoints: 0,
    level: 0,
    nickname: '',
    lastActiveDate: '', // 空 = 尚无活跃记录，首条消息即记为新的一天
    updatedAt: new Date(),
  };
}

/** 单条消息的深度分（千分制；√长度×2，上限 50/条） */
export function messageDepthScore(content: string): number {
  return Math.min(50, Math.round(Math.sqrt(content.length) * 2));
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayYmd(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * 消息到达后更新养成聚合行（纯函数，不碰 DB）
 */
export function updateBondOnMessage(bond: BondRow, userContent: string): BondRow {
  const today = todayYmd();
  const isNewDay = bond.lastActiveDate !== today;
  const isConsecutive = bond.lastActiveDate === yesterdayYmd();

  const messageCount = bond.messageCount + 1;
  const depthScore = bond.depthScore + messageDepthScore(userContent);

  let activeDays = bond.activeDays;
  let streakDays = bond.streakDays;
  if (isNewDay) {
    activeDays += 1;
    streakDays = isConsecutive ? streakDays + 1 : 1;
  }
  const maxStreak = Math.max(bond.maxStreak, streakDays);

  const depthN = Math.min(1, Math.log10(1 + depthScore) / Math.log10(1 + 5000));
  const msgN = Math.min(1, Math.log10(1 + messageCount) / Math.log10(1 + 1000));
  const daysN = Math.min(1, activeDays / 90);
  const streakN = Math.min(1, streakDays / 30);

  const bondPoints = Math.round((depthN * 0.45 + msgN * 0.25 + daysN * 0.20 + streakN * 0.10) * 1000);
  const level = Math.max(bond.level, deriveLevel(bondPoints));

  return { ...bond, messageCount, activeDays, streakDays, maxStreak, depthScore, bondPoints, level, lastActiveDate: today, updatedAt: new Date() };
}

/** 亲密度 0~1（bondPoints / 1000 截断到 1） */
export function familiarityOf(bond: BondRow): number {
  return Math.min(1, Math.max(0, bond.bondPoints / 1000));
}

/* ============================================================================
 * DB 读写
 * ==========================================================================*/

export async function readBondRow(): Promise<BondRow> {
  try {
    const rows = await db.select().from(aiBond).where(eq(aiBond.id, 'owner')).limit(1);
    if (rows[0]) return rows[0] as unknown as BondRow;
  } catch { /* 表可能还没建 */ }
  return defaultBondRow();
}

export async function saveBondRow(bond: BondRow): Promise<void> {
  await dbWrite(async (d) => {
    await d.insert(aiBond).values(bond).onConflictDoUpdate({ target: aiBond.id, set: bond });
  });
}

/** 消息到达后的一站式更新（读 → 改 → 写）；失败静默（养成是附加值） */
export async function bumpBondOnMessage(userContent: string): Promise<BondRow> {
  try {
    const current = await readBondRow();
    const updated = updateBondOnMessage(current, userContent);
    await saveBondRow(updated);
    return updated;
  } catch (err) {
    console.error('[ai-bond] bumpBondOnMessage 失败:', (err as Error).message);
    return defaultBondRow();
  }
}

/** 亲密度快照（供 chat meta 帧下发） */
export interface BondSnapshot {
  level: number;
  familiarity: number;
}

export async function readBondSnapshot(): Promise<BondSnapshot> {
  const row = await readBondRow();
  return { level: row.level, familiarity: familiarityOf(row) };
}
