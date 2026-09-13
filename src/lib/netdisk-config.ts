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
 * - 双账号设计：admin 账号供服务端调用（列目录/取直链/转存/删除），
 *   uploader 是 AList 侧建的**受限子账号**（只能写暂存目录），供浏览器直传大文件用。
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
  /** 受限子账号（浏览器直传用；只能写暂存目录） */
  uploaderUsername: string;
  /** 受限子账号密码（序列化时掩码） */
  uploaderPassword: string;
  /** 管理页根目录（AList 虚拟路径） */
  managePath: string;
  /** 上传落点目录（厂商网盘内的目标目录） */
  targetDir: string;
  /** 大文件暂存目录（AList Local 驱动挂载点，先落本地再跨存储复制） */
  stagingDir: string;
  /**
   * 分流阈值（字节）：**0 = 全部走浏览器直传**；非 0 时 ≤ 阈值经本站函数转发，
   * > 阈值走直传。
   *
   * 默认 0（全部直传）：本站部署在 Vercel（美区），经函数转发意味着文件正文要
   * 两次横跨太平洋（浏览器→Vercel→Cloudflare 隧道→本机 AList），实测 2MB 需 72 秒；
   * 而直传只需「浏览器→Cloudflare→本机 AList」，同一文件 1.3 秒。
   * 仅当直传不可用（未配受限子账号）时才回落到函数转发。
   */
  smallFileMaxBytes: number;
  /** 单文件上限（字节）。分片直传可绕开 Cloudflare 100MB，默认放宽到 10GB（受厂商单文件上限约束，如蓝奏云 100MB/500MB、123 盘 10G） */
  maxFileBytes: number;
}

/** 默认值（关闭态） */
export const DEFAULT_NETDISK: NetdiskConfig = {
  enabled: false,
  baseUrl: '',
  adminUsername: '',
  adminPassword: '',
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

/** 是否具备浏览器直传能力（额外要求受限子账号齐全） */
export function isNetdiskDirectUploadReady(c: NetdiskConfig): boolean {
  return isNetdiskReady(c) && c.uploaderUsername.trim() !== '' && c.uploaderPassword.trim() !== '';
}
