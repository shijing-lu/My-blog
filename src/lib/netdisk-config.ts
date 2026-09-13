/**
 * 网盘对接配置（DB settings 表持久化，管理员在线配置，不落 .env）
 *
 * 架构：网站 → 自建 AList 中转层 → 各厂商网盘（蓝奏云等）。
 * 本模块只负责「网站 ↔ AList」这一段的配置，**与具体厂商网盘完全解耦**：
 * 要接入新网盘只需在 AList 后台加驱动，本站零改动。
 *
 * - 存储：settings 表的 `netdisk` 键（JSON），与 image_bed / ai_config 同模式；
 * - 两类密码明文仅存 DB，读取接口只回掩码（hasXxxPassword 布尔），明文不回前端；
 * - 保存时密码留空 → 保留原值（表单「留空=不修改」语义）；
 * - **只读改造**：网盘页现仅保留「列目录 / 取直链 / 复制分享链接」，
 *   上传/下载/新建/删除等写操作与配套的浏览器直传子账号已移除；
 *   下述 uploaderUsername、uploaderPassword、targetDir、stagingDir、
 *   smallFileMaxBytes、maxFileBytes 为历史遗留字段，仅为兼容旧 DB 记录而保留
 *   （标 @deprecated），新逻辑一律不再读写。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** 配置键 */
const KEY = 'netdisk';

/** 网盘对接配置 */
export interface NetdiskConfig {
  /** 总开关（关闭时管理页与相关接口返回「未启用」） */
  enabled: boolean;
  /** AList 地址（生产 = Cloudflare Tunnel 域名；本地开发 = http://127.0.0.1:5244） */
  baseUrl: string;
  /** AList 管理员账号（服务端调用用） */
  adminUsername: string;
  /** AList 管理员密码（序列化时掩码，不回传明文） */
  adminPassword: string;
  /**
   * @deprecated 网盘页已改为**只读**模式（移除上传/下载/新建/删除全部写操作）。
   * 该字段为历史遗留的浏览器直传受限子账号，保留仅为兼容旧 DB 记录，新配置不再写入。
   */
  uploaderUsername: string;
  /** @deprecated 见 uploaderUsername（只读改造后不再使用） */
  uploaderPassword: string;
  /** 管理页根目录（AList 虚拟路径） */
  managePath: string;
  /** @deprecated 上传落点目录；网盘页改为只读后不再使用，保留仅兼容旧 DB 记录 */
  targetDir: string;
  /** @deprecated 大文件暂存目录；网盘页改为只读后不再使用，保留仅兼容旧 DB 记录 */
  stagingDir: string;
  /**
   * @deprecated 分流阈值（旧浏览器直传/函数转发分流用）；只读改造后不再使用。
   * 保留字段仅为兼容旧 DB 记录，勿再写入或读取。
   */
  smallFileMaxBytes: number;
  /** @deprecated 单文件上限（旧直传/分片用）；只读改造后不再使用，保留仅兼容旧 DB 记录 */
  maxFileBytes: number;
}

/** 默认值（关闭态） */
export const DEFAULT_NETDISK: NetdiskConfig = {
  enabled: false,
  baseUrl: '',
  adminUsername: '',
  adminPassword: '',
  // 历史遗留字段（@deprecated）：uploaderUsername/uploaderPassword/targetDir/stagingDir
  // 与末尾的 smallFileMaxBytes/maxFileBytes，保留仅为兼容旧 DB 记录
  uploaderUsername: '',
  uploaderPassword: '',
  managePath: '/',
  targetDir: '/',
  stagingDir: '/local/_netdisk_staging',
  /** 0 = 全部走浏览器直传（绕开 Vercel 中转，见字段注释） */
  smallFileMaxBytes: 0,
  maxFileBytes: 10 * 1024 * 1024 * 1024,
};

/** 前端可见形态：两个密码换成 hasXxx 布尔 */
export type PublicNetdiskConfig = Omit<NetdiskConfig, 'adminPassword' | 'uploaderPassword'> & {
  hasAdminPassword: boolean;
  /** @deprecated 只读改造后不再有直传子账号；保留仅为兼容旧前端缓存 */
  hasUploaderPassword: boolean;
};

/** 文本清洗：trim + 长度上限 */
function cleanText(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

/** 字节数清洗：非法/越界回落原值，上限 20GB（分片直传已可承载超大文件）；下限默认 1KB（传 0 可允许「全部直传」语义） */
function cleanBytes(v: unknown, base: number, minBytes = 1024): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return base;
  return Math.min(Math.max(Math.floor(n), minBytes), 20 * 1024 * 1024 * 1024);
}

/** AList 路径规范化：确保以 / 开头、无重复斜杠、去尾部斜杠（根除外） */
export function normalizeAlistPath(input: string): string {
  let p = cleanText(input, 500) || '/';
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** 规范化（PATCH 语义：文本留空 = 保留原值） */
function normalizeConfig(input: Partial<NetdiskConfig>, base: NetdiskConfig): NetdiskConfig {
  const text = (v: unknown, max: number, fallback: string): string => cleanText(v, max) || fallback;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    baseUrl: (cleanText(input.baseUrl, 300) || base.baseUrl).replace(/\/+$/, ''),
    adminUsername: text(input.adminUsername, 100, base.adminUsername),
    adminPassword:
      typeof input.adminPassword === 'string' && input.adminPassword.trim() !== ''
        ? input.adminPassword.trim()
        : base.adminPassword,
    uploaderUsername: text(input.uploaderUsername, 100, base.uploaderUsername),
    uploaderPassword:
      typeof input.uploaderPassword === 'string' && input.uploaderPassword.trim() !== ''
        ? input.uploaderPassword.trim()
        : base.uploaderPassword,
    managePath: normalizeAlistPath(cleanText(input.managePath, 500) || base.managePath),
    targetDir: normalizeAlistPath(cleanText(input.targetDir, 500) || base.targetDir),
    stagingDir: normalizeAlistPath(cleanText(input.stagingDir, 500) || base.stagingDir),
    // 阈值下限允许 0（0 = 全部走浏览器直传，见 smallFileMaxBytes 注释）
    smallFileMaxBytes: cleanBytes(input.smallFileMaxBytes, base.smallFileMaxBytes, 0),
    maxFileBytes: cleanBytes(input.maxFileBytes, base.maxFileBytes),
  };
}

/** 读取配置（无记录/解析失败回落默认） */
export async function getNetdiskConfig(): Promise<NetdiskConfig> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return { ...DEFAULT_NETDISK };
    const parsed = JSON.parse(raw) as Partial<NetdiskConfig>;
    return normalizeConfig(parsed, { ...DEFAULT_NETDISK });
  } catch {
    return { ...DEFAULT_NETDISK };
  }
}

/** 保存配置（upsert）。密码留空 = 保留原值；返回保存后的完整配置 */
export async function saveNetdiskConfig(input: Partial<NetdiskConfig>): Promise<NetdiskConfig> {
  const current = await getNetdiskConfig();
  const normalized = normalizeConfig(input ?? {}, current);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(normalized), updatedAt: now },
      }),
  );
  return normalized;
}

/** 序列化给前端：两个密码不回传明文，仅给 hasXxx 布尔 */
export function serializeNetdiskConfig(c: NetdiskConfig): PublicNetdiskConfig {
  const { adminPassword, uploaderPassword, ...rest } = c;
  return {
    ...rest,
    hasAdminPassword: adminPassword.trim() !== '',
    hasUploaderPassword: uploaderPassword.trim() !== '',
  };
}

/** 是否具备服务端调用能力（开关开 + 地址 + 管理员账号密码齐全） */
export function isNetdiskReady(c: NetdiskConfig): boolean {
  return c.enabled && c.baseUrl.trim() !== '' && c.adminUsername.trim() !== '' && c.adminPassword.trim() !== '';
}

/**
 * @deprecated 网盘页改为只读后不再有浏览器直传，此判断恒为「仅看管理员账号」。
 * 保留函数仅为兼容旧调用点；新代码请直接用 isNetdiskReady。
 */
export function isNetdiskDirectUploadReady(c: NetdiskConfig): boolean {
  return isNetdiskReady(c) && c.uploaderUsername.trim() !== '' && c.uploaderPassword.trim() !== '';
}
