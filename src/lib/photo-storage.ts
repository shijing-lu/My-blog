/**
 * 相册照片存储抽象（GitHub 图床 / Cloudflare R2 双通道）
 *
 * - 照片字节存对象存储，DB 只存元数据 + key/URL；
 * - ⚠️ 2026-09-23 修正：原实现**只认 R2**（`photoStorageEnabled = r2Enabled()`），
 *   于是「配了 GitHub 图床但没配 R2」的环境（典型：桌面端 + 线上站图床）会被判定
 *   「自动上传不可用」→ 上传页整块隐藏上传区，用户点进来只看到空白。
 *   而文章/动态的图片上传（`/api/images`）一直是**双通道**：图床开启且就绪 → 图床，
 *   失败/未开 → R2 回落。此处补齐同样的策略，两条链路行为对齐。
 * - 判定必须异步：图床配置存在 `settings` 表（`getImageBedConfig()` 是异步的），
 *   不能像原先那样在模块加载时同步求值一次。
 */
import { randomUUID } from 'node:crypto';
import { r2Enabled, putObject } from '@/lib/object-storage';
import { getImageBedConfig, isImageBedReady } from '@/lib/image-bed';
import { uploadToGitHub } from '@/lib/gh-image-bed';
import { storeImageViaGitHub } from '@/lib/images';

/**
 * 影集「选择文件上传」是否可用：**R2 或 GitHub 图床任一就绪**即可。
 *
 * 与 `/api/images` 的可用性口径一致（那里是图床优先、R2 回落，两者都不可用才报错）。
 * 上传页据此决定渲染上传区还是降级提示；`/api/photos` 的自动上传分支用同一定义守卫。
 */
export async function photoStorageReady(): Promise<boolean> {
  if (r2Enabled()) return true;
  try {
    const bed = await getImageBedConfig();
    return isImageBedReady(bed);
  } catch {
    // 配置读取失败（DB 抖动等）→ 视为不可用，与 /api/images 的容错口径一致
    return false;
  }
}
/** 删除 R2 对象（兼容旧导入名） */
export { deleteObject as deletePhotoObject } from '@/lib/object-storage';

/** MIME → 文件扩展名（对象 key 后缀，便于直观，非必需） */
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * 上传照片原图/缩略图，返回可公开访问的 URL
 *
 * 通道策略与 `/api/images` 完全一致（保持两条链路行为对齐，勿单独改动其一）：
 * 1. **GitHub 图床**：开关开启且配置就绪 → 上传仓库，元数据落 `images` 表，
 *    返回站内稳定路径 `/api/images/<id>`（由该路由 307 重定向到图床，下游全部无感）；
 * 2. **回落 R2**：图床未开/未就绪/上传失败 → 走原 R2 流程（不阻断、不上报错误）。
 *
 * 两者的对外 URL 都是 `/api/images/<id>`（R2 亦是，见 getImage 链路），
 * 因此影集卡片、缩略图、尺寸注入等下游逻辑对通道无感。
 *
 * @param buffer 图片二进制
 * @param mime 图片 MIME
 * @param key 对象 key（由调用方生成，如 photos/<uuid>）；图床通道忽略该参数（路径由 gh-image-bed 生成）
 * @returns 公开可访问的 URL（站内稳定路径）
 */
export async function uploadPhotoObject(
  buffer: Buffer,
  mime: string,
  key?: string,
): Promise<{ url: string }> {
  // 1) GitHub 图床通道
  try {
    const bed = await getImageBedConfig();
    if (isImageBedReady(bed)) {
      const gh = await uploadToGitHub(bed, buffer, mime);
      if (gh.ok) {
        const stored = await storeImageViaGitHub(mime, buffer, gh.path);
        return { url: `/api/images/${stored.id}` };
      }
    }
  } catch {
    // 图床异常（配置读取失败 / 上传失败）→ 静默回落 R2，与 /api/images 的容错一致
  }

  // 2) R2 通道（原流程）
  if (!r2Enabled()) {
    throw new Error('未配置 R2 且 GitHub 图床不可用，无法上传照片。请在设置中配置图床或 R2');
  }
  const ext = EXT[mime] ?? 'bin';
  const objectKey = key ?? `photos/${randomUUID()}.${ext}`;
  const url = await putObject(objectKey, { buffer, contentType: mime });
  return { url };
}
