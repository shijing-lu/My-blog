/**
 * 站主口令的运行时覆盖存储
 *
 * 背景：`ADMIN_PASSWORD` / `TOP_ADMIN_PASSWORD` 只能来自环境变量（`.env` 或桌面端
 * `config.json`），站主改口令必须改文件再重启。这里把「站主自己改过的口令」以
 * scrypt 摘要存进 settings 表，登录时**优先**比对它；没有覆盖记录时才回落到环境变量。
 *
 * 约定：
 * - 只存摘要，不存明文；每条记录独立随机盐，参数一并写入（将来换 scrypt 参数仍能校验旧记录）。
 * - 该键**不参与云同步**（见 src/sync/tables.ts 的 excludeWhere）：口令属于本机凭据，
 *   不应该因为桌面端同步就把云端站点的口令一起改掉。
 * - 修改口令后，已签发的 HMAC 会话无法回收（无服务端会话表），最多在 7 天 TTL 内自然失效；
 *   移动端会话由 ownerPasswordFingerprint 派生，改口令即全部失效。
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';
import { serverEnv } from './env';
import { checkPassword } from './auth';
import { checkTopPassword, topAdminPassword } from './admin-auth';

/** settings 表键名 */
const KEY = 'owner_password';

/** scrypt 参数：约 16MB 内存、数十毫秒，一次登录的开销可以接受 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
/** 显式给足内存上限，避免不同 Node 版本默认 maxmem 收紧后直接抛错 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** 新口令长度边界 */
export const MIN_OWNER_PASSWORD_LENGTH = 8;
export const MAX_OWNER_PASSWORD_LENGTH = 128;

/** 口令来源：自定义 > 独立站主口令 > 登录口令 > 未配置 */
export type OwnerPasswordSource = 'custom' | 'env-top' | 'env-admin' | 'none';

/** 存储口令的记录结构 */
export interface OwnerPasswordRecord {
  /** 记录版本：将来换算法时据此区分 */
  v: 1;
  /** 算法标识 */
  algo: 'scrypt';
  /** scrypt 参数（随记录保存，避免换默认参数后旧摘要失效） */
  N: number;
  r: number;
  p: number;
  /** 盐与摘要（base64url） */
  salt: string;
  /** 摘要（base64url） */
  hash: string;
  /** 最近一次修改时间（ISO） */
  updatedAt: string;
}

/** 计算摘要 */
function digest(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return scryptSync(password, salt, SCRYPT.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** 生成口令记录（纯函数，便于单测） */
export function hashOwnerPassword(password: string, now: Date = new Date()): OwnerPasswordRecord {
  const salt = randomBytes(16);
  return {
    v: 1,
    algo: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString('base64url'),
    hash: digest(password, salt, SCRYPT).toString('base64url'),
    updatedAt: now.toISOString(),
  };
}

/** 校验口令是否匹配记录（恒定时间比较；记录损坏一律返回 false） */
export function verifyOwnerPasswordHash(password: string, record: OwnerPasswordRecord): boolean {
  if (!password || !record?.salt || !record?.hash) return false;
  try {
    const expected = Buffer.from(record.hash, 'base64url');
    const actual = digest(password, Buffer.from(record.salt, 'base64url'), {
      N: record.N || SCRYPT.N,
      r: record.r || SCRYPT.r,
      p: record.p || SCRYPT.p,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 读取自定义口令记录（无记录或损坏返回 null） */
export async function getOwnerPasswordRecord(): Promise<OwnerPasswordRecord | null> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OwnerPasswordRecord>;
    if (parsed?.v !== 1 || typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') return null;
    return parsed as OwnerPasswordRecord;
  } catch {
    return null;
  }
}

/** 是否已经自定义过口令（决定后台是否提示「还在用初始密码」） */
export async function hasCustomOwnerPassword(): Promise<boolean> {
  return (await getOwnerPasswordRecord()) !== null;
}

/** 写入自定义口令，返回落库的记录 */
export async function saveOwnerPassword(password: string): Promise<OwnerPasswordRecord> {
  const record = hashOwnerPassword(password);
  const value = JSON.stringify(record);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }),
  );
  return record;
}

/**
 * 环境变量提供的初始口令。
 * 与既有移动端鉴权语义保持一致：配了独立站主口令（TOP_ADMIN_PASSWORD）时**只认它**，
 * 否则才回落到登录口令（ADMIN_PASSWORD）——避免两套口令并存时弱的那条继续有效。
 */
function matchesConfiguredPassword(input: string): boolean {
  return topAdminPassword() ? checkTopPassword(input) : checkPassword(input);
}

/**
 * 校验站主口令（登录用）。
 * 有自定义记录 → 只认记录；否则回落到环境变量的初始口令。
 */
export async function verifyOwnerPassword(input: string): Promise<boolean> {
  if (typeof input !== 'string' || !input) return false;
  const record = await getOwnerPasswordRecord();
  return record ? verifyOwnerPasswordHash(input, record) : matchesConfiguredPassword(input);
}

/**
 * 口令版本指纹：口径变化即指纹变化。
 * 移动端把它派生进 credentialVersion，因此改口令会让所有已签发的移动会话立即失效。
 */
export async function ownerPasswordFingerprint(): Promise<string> {
  const record = await getOwnerPasswordRecord();
  const material = record
    ? `custom:${record.hash}`
    : `env:${serverEnv('TOP_ADMIN_PASSWORD') || serverEnv('ADMIN_PASSWORD')}`;
  return createHash('sha256').update(`owner-password-v1:${material}`).digest('hex');
}

/** 当前口令来源（后台展示用） */
export async function ownerPasswordStatus(): Promise<{
  custom: boolean;
  source: OwnerPasswordSource;
  updatedAt: string | null;
}> {
  const record = await getOwnerPasswordRecord();
  if (record) return { custom: true, source: 'custom', updatedAt: record.updatedAt };
  if (topAdminPassword()) return { custom: false, source: 'env-top', updatedAt: null };
  if (serverEnv('ADMIN_PASSWORD')) return { custom: false, source: 'env-admin', updatedAt: null };
  return { custom: false, source: 'none', updatedAt: null };
}

/**
 * 校验新口令格式（纯函数，可单测）。
 * 返回 { password } 表示通过，返回 { error } 表示拒绝原因。
 */
export function validateNewOwnerPassword(
  input: unknown,
  current = '',
): { password: string } | { error: string } {
  if (typeof input !== 'string') return { error: '请输入新密码' };
  const password = input.normalize('NFC');
  if (password.trim() !== password) return { error: '新密码首尾不能有空白字符' };
  const length = [...password].length;
  if (length < MIN_OWNER_PASSWORD_LENGTH) return { error: `新密码至少 ${MIN_OWNER_PASSWORD_LENGTH} 位` };
  if (length > MAX_OWNER_PASSWORD_LENGTH) return { error: `新密码不能超过 ${MAX_OWNER_PASSWORD_LENGTH} 位` };
  if (current && password === current) return { error: '新密码不能与当前密码相同' };
  return { password };
}
