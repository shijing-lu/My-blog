/**
 * 个人中心信息（昵称/头像/座右铭/简介/位置）
 *
 * - 存储：settings 表 `site_profile` 键（JSON）；
 * - 公开读取（首页名片、导航头像、动态卡片联动展示），管理员可编辑。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db } from '../../db';

/** 个人信息 */
export interface Profile {
  /** 昵称（空则显示默认「博主」） */
  nickname: string;
  /** 头像 URL（本站 /api/images/… 或外链） */
  avatar: string;
  /** 座右铭 */
  motto: string;
  /** 简介 */
  bio: string;
  /** 位置 */
  location: string;
}

/** 配置键 */
const KEY = 'site_profile';

/** 默认（空） */
export const DEFAULT_PROFILE: Profile = {
  nickname: '',
  avatar: '',
  motto: '',
  bio: '',
  location: '',
};

/** 取字符串并截断 */
function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 规范化校验 */
function normalize(input: Partial<Profile>): Profile {
  return {
    nickname: str(input.nickname, 30),
    avatar: str(input.avatar, 2048),
    motto: str(input.motto, 100),
    bio: str(input.bio, 500),
    location: str(input.location, 100),
  };
}

/** 读取个人信息（DB 优先，无记录/损坏回落到默认） */
export async function getProfile(): Promise<Profile> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_PROFILE;
    return normalize(JSON.parse(raw) as Partial<Profile>);
  } catch {
    return DEFAULT_PROFILE;
  }
}

/** 保存个人信息（upsert） */
export async function saveProfile(input: Partial<Profile>): Promise<Profile> {
  const normalized = normalize(input);
  const now = new Date();
  await db
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt: now } });
  return normalized;
}
