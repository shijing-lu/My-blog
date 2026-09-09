/**
 * GitHub 图床配置（DB settings 表持久化，管理员在线配置，不落 .env）
 *
 * - 存储：settings 表的 `image_bed` 键（JSON），与 hero_quotes 同模式；
 * - token 明文仅存 DB，读取接口只回传掩码（hasToken 布尔），明文不回前端；
 * - 保存时 token 留空 → 保留原值（表单「留空=不修改」语义）；
 * - enabled=false 或必填项缺失时，图片上传沿用原 R2 流程（isImageBedReady 判定）。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** settings 表行 */
type SettingsRow = typeof settings.$inferSelect;

/** 配置键 */
const KEY = 'image_bed';

/** GitHub 图床配置 */
export interface ImageBedConfig {
  /** 是否启用 GitHub 图床（关闭时图片走原 R2 流程） */
  enabled: boolean;
  /** 仓库属主（用户名或组织名） */
  owner: string;
  /** 仓库名（建议独立 public 仓库） */
  repo: string;
  /** 分支名 */
  branch: string;
  /** Fine-grained PAT（仅该仓库 Contents 读写权限）；序列化时掩码，不回传明文 */
  token: string;
}

/** 仓库内目录前缀（固定值）：路径 <PREFIX>/<yyyy>/<mm>/<hash10>.<ext>，与站点 URL /img/... 1:1 映射 */
export const IMAGE_BED_PREFIX = 'img';

/** 未配置时的默认值（图床关闭） */
export const DEFAULT_IMAGE_BED: ImageBedConfig = {
  enabled: false,
  owner: '',
  repo: '',
  branch: 'main',
  token: '',
};

/** 前端可见的配置形态：token 换成 hasToken 布尔 */
export type PublicImageBedConfig = Omit<ImageBedConfig, 'token'> & { hasToken: boolean };

/** 文本字段清洗：trim + 长度上限 */
function cleanText(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

/** 规范化并校验配置（PATCH 语义：文本字段留空 = 保留原值，防止部分更新误清空） */
function normalizeConfig(input: Partial<ImageBedConfig>, base: ImageBedConfig): ImageBedConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    owner: cleanText(input.owner, 100) || base.owner,
    repo: cleanText(input.repo, 100) || base.repo,
    branch: cleanText(input.branch, 100) || base.branch || 'main',
    // token：非空字符串才更新（空 = 保留原值）
    token: typeof input.token === 'string' && input.token.trim() !== '' ? input.token.trim() : base.token,
  };
}

/** 读取配置（无记录/解析失败回落默认） */
export async function getImageBedConfig(): Promise<ImageBedConfig> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return { ...DEFAULT_IMAGE_BED };
    const parsed = JSON.parse(raw) as Partial<ImageBedConfig>;
    return normalizeConfig(parsed, { ...DEFAULT_IMAGE_BED });
  } catch {
    return { ...DEFAULT_IMAGE_BED };
  }
}

/** 保存配置（upsert）。token 留空 = 保留原值；返回保存后的完整配置 */
export async function saveImageBedConfig(input: Partial<ImageBedConfig>): Promise<ImageBedConfig> {
  const current = await getImageBedConfig();
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

/** 序列化给前端：token 不回传明文，仅给 hasToken 布尔 */
export function serializeImageBedConfig(c: ImageBedConfig): PublicImageBedConfig {
  const { token, ...rest } = c;
  return { ...rest, hasToken: token.trim() !== '' };
}

/** 图床是否就绪（开关开 + owner/repo/token 齐全）。repo/branch 形态合法性交给「测试连接」验证 */
export function isImageBedReady(c: ImageBedConfig): boolean {
  return c.enabled && c.owner.trim() !== '' && c.repo.trim() !== '' && c.token.trim() !== '';
}

export type { SettingsRow };
